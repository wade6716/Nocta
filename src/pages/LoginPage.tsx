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
} from 'lucide-react';
import {
  testServerConnection,
  authenticateByName,
  normalizeServerUrl,
} from '../api/embyClient';
import { useAuthStore } from '../stores/useAuthStore';
import { EmbyServerModal } from '../components/settings/EmbyServerModal';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { servers, addOrUpdateServer, removeServer, setCurrentServer } = useAuthStore();

  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
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
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center space-x-2">
            <span>Nocta</span>
            <span className="text-sm px-2.5 py-0.5 rounded-full bg-primary/20 text-primary font-medium tracking-normal">
              夜幕
            </span>
          </h1>
          <p className="text-xs text-gray-400">暗色沉浸式私人影院 · 银幕与弹幕的双重盛宴</p>
        </div>

        {/* Saved servers quick entry */}
        {servers.length > 0 && (
          <div className="bg-surface/80 border border-white/5 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                已保存的服务器
              </span>
              <button
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
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block">
            添加新连接
          </span>

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
      </div>

      {/* Emby 服务器管理 / 编辑弹窗 */}
      <EmbyServerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        initialEditId={editingServerId}
      />
    </div>
  );
};

export default LoginPage;
