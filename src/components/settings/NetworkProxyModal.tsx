import React, { useState, useEffect } from 'react';
import {
  Globe,
  Server,
  RefreshCw,
  CheckCircle2,
  XCircle,
  X,
  Shield,
  Zap,
  Radio,
  ExternalLink,
} from 'lucide-react';
import {
  ProxyConfig,
  ProxyType,
  fetchSystemProxy,
  SystemProxyResult,
} from '../../api/http';
import { useAuthStore } from '../../stores/useAuthStore';

interface NetworkProxyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TestTargetType = 'google' | 'emby' | 'custom';

export const NetworkProxyModal: React.FC<NetworkProxyModalProps> = ({ isOpen, onClose }) => {
  const { globalProxyConfig, updateGlobalProxyConfig, getCurrentServer, testProxyConnection } =
    useAuthStore();

  const currentServer = getCurrentServer();

  // Mode: 'system' | 'manual' | 'direct'
  const [proxyType, setProxyType] = useState<ProxyType>(globalProxyConfig.type || 'system');
  const [serverUrl, setServerUrl] = useState(
    globalProxyConfig.serverUrl ||
      (globalProxyConfig.server
        ? `${globalProxyConfig.type === 'socks5' ? 'socks5' : 'http'}://${globalProxyConfig.server}${
            globalProxyConfig.port ? `:${globalProxyConfig.port}` : ''
          }`
        : '')
  );
  const [username, setUsername] = useState(globalProxyConfig.username || '');
  const [password, setPassword] = useState(globalProxyConfig.password || '');

  // System Proxy Detection state
  const [systemProxy, setSystemProxy] = useState<SystemProxyResult>({ enabled: false, url: null });
  const [detectingSystem, setDetectingSystem] = useState(false);

  // Connectivity Test state
  const [testTargetType, setTestTargetType] = useState<TestTargetType>(
    currentServer ? 'emby' : 'google'
  );
  const [customTestUrl, setCustomTestUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latency?: number;
    error?: string;
  } | null>(null);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      setProxyType(globalProxyConfig.type || 'system');
      setServerUrl(
        globalProxyConfig.serverUrl ||
          (globalProxyConfig.server
            ? `${globalProxyConfig.type === 'socks5' ? 'socks5' : 'http'}://${globalProxyConfig.server}${
                globalProxyConfig.port ? `:${globalProxyConfig.port}` : ''
              }`
            : '')
      );
      setUsername(globalProxyConfig.username || '');
      setPassword(globalProxyConfig.password || '');
      setTestResult(null);
      handleDetectSystemProxy(false);
    }
  }, [isOpen, globalProxyConfig]);

  const handleDetectSystemProxy = async (force = true) => {
    setDetectingSystem(true);
    try {
      const res = await fetchSystemProxy(force);
      setSystemProxy(res);
    } catch (e) {
      console.warn(e);
    } finally {
      setDetectingSystem(false);
    }
  };

  const getTargetUrl = (): string => {
    switch (testTargetType) {
      case 'google':
        return 'https://www.google.com/generate_204';
      case 'emby':
        return currentServer?.url || 'https://www.google.com/generate_204';
      case 'custom':
        return customTestUrl.trim() || 'https://www.google.com/generate_204';
    }
  };

  const handleTestConnection = async () => {
    const candidateConfig: ProxyConfig = {
      type: proxyType,
      serverUrl: serverUrl.trim() || undefined,
      username: username.trim() || undefined,
      password: password.trim() || undefined,
    };

    const target = getTargetUrl();
    if (!target) return;

    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProxyConnection(candidateConfig, target);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message || '测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const newConfig: ProxyConfig = {
      type: proxyType,
      serverUrl: serverUrl.trim() || undefined,
      username: username.trim() || undefined,
      password: password.trim() || undefined,
    };
    updateGlobalProxyConfig(newConfig);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#161922] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-primary/20 text-primary">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">网络与代理设置</h2>
              <p className="text-xs text-gray-400">
                配置 Emby 媒体库 API 与 原生视频播放 (libmpv) 的代理网络
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Proxy Mode Selector */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider block">
              代理模式选择
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {/* Option 1: System */}
              <button
                type="button"
                onClick={() => setProxyType('system')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                  proxyType === 'system'
                    ? 'bg-primary/15 border-primary text-white shadow-lg shadow-primary/10'
                    : 'bg-card hover:bg-white/5 border-white/5 text-gray-400'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xs font-bold text-white">跟随系统代理</span>
                  <Zap
                    className={`w-3.5 h-3.5 ${
                      proxyType === 'system' ? 'text-primary' : 'text-gray-500'
                    }`}
                  />
                </div>
                <span className="text-[11px] text-gray-400 leading-tight">
                  自动读取操作系统设置 (推荐)
                </span>
              </button>

              {/* Option 2: Manual */}
              <button
                type="button"
                onClick={() => setProxyType('manual')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                  proxyType === 'manual'
                    ? 'bg-primary/15 border-primary text-white shadow-lg shadow-primary/10'
                    : 'bg-card hover:bg-white/5 border-white/5 text-gray-400'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xs font-bold text-white">手动自定义</span>
                  <Radio
                    className={`w-3.5 h-3.5 ${
                      proxyType === 'manual' ? 'text-primary' : 'text-gray-500'
                    }`}
                  />
                </div>
                <span className="text-[11px] text-gray-400 leading-tight">
                  自定义 HTTP/SOCKS 端口
                </span>
              </button>

              {/* Option 3: Direct */}
              <button
                type="button"
                onClick={() => setProxyType('direct')}
                className={`p-3 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                  proxyType === 'direct'
                    ? 'bg-primary/15 border-primary text-white shadow-lg shadow-primary/10'
                    : 'bg-card hover:bg-white/5 border-white/5 text-gray-400'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xs font-bold text-white">直连模式</span>
                  <Shield
                    className={`w-3.5 h-3.5 ${
                      proxyType === 'direct' ? 'text-primary' : 'text-gray-500'
                    }`}
                  />
                </div>
                <span className="text-[11px] text-gray-400 leading-tight">
                  不走代理，本地直接连接
                </span>
              </button>
            </div>
          </div>

          {/* Mode 1: System Proxy Inspection info */}
          {proxyType === 'system' && (
            <div className="p-3.5 rounded-xl bg-card border border-white/5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 font-medium">当前操作系统代理探测结果：</span>
                <button
                  type="button"
                  onClick={() => handleDetectSystemProxy(true)}
                  disabled={detectingSystem}
                  className="text-xs text-primary hover:text-primary-hover flex items-center space-x-1 cursor-pointer transition"
                >
                  <RefreshCw className={`w-3 h-3 ${detectingSystem ? 'animate-spin' : ''}`} />
                  <span>重新探测</span>
                </button>
              </div>

              {systemProxy.enabled && systemProxy.url ? (
                <div className="flex items-center space-x-2 text-xs text-emerald-400 font-mono bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                  <span className="truncate">已检测到系统代理：{systemProxy.url}</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 text-xs text-amber-300 font-mono bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  <span>系统当前未开启代理（将自动采用直连访问）</span>
                </div>
              )}
              <p className="text-[11px] text-gray-500 leading-normal">
                提示：支持 Windows 注册表、macOS 预设与 Linux 系统代理。当您在 Clash / v2rayN 等工具中打开或关闭系统代理开关时，Nocta 将自动同步应用。
              </p>
            </div>
          )}

          {/* Mode 2: Manual Proxy inputs */}
          {proxyType === 'manual' && (
            <div className="p-4 rounded-xl bg-card border border-white/5 space-y-3.5 animate-in fade-in duration-150">
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">
                  代理服务器地址与端口 (支持 HTTP / SOCKS5)
                </label>
                <input
                  type="text"
                  placeholder="例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:10808"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#12141a] border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary transition font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">
                    代理用户名 (可选)
                  </label>
                  <input
                    type="text"
                    placeholder="若代理需鉴权请填写"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 bg-[#12141a] border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">
                    代理密码 (可选)
                  </label>
                  <input
                    type="password"
                    placeholder="若代理需鉴权请填写"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-[#12141a] border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary transition"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Connectivity Test Section */}
          <div className="p-4 rounded-xl bg-card/60 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span>代理连通性测试</span>
              </span>
              {testResult && (
                <span
                  className={`text-xs font-semibold flex items-center space-x-1 ${
                    testResult.ok ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {testResult.ok ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>测试通过 · {testResult.latency} ms</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[180px]">{testResult.error || '连接失败'}</span>
                    </>
                  )}
                </span>
              )}
            </div>

            {/* Target Options */}
            <div className="space-y-2">
              <div className="flex items-center space-x-3 text-xs">
                {/* Option: Google */}
                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="radio"
                    name="testTarget"
                    value="google"
                    checked={testTargetType === 'google'}
                    onChange={() => setTestTargetType('google')}
                    className="text-primary focus:ring-0"
                  />
                  <span>Google (验证外网梯子)</span>
                </label>

                {/* Option: Current Emby Server */}
                <label
                  className={`flex items-center space-x-1.5 ${
                    currentServer ? 'cursor-pointer text-gray-300 hover:text-white' : 'opacity-40 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="radio"
                    name="testTarget"
                    value="emby"
                    disabled={!currentServer}
                    checked={testTargetType === 'emby'}
                    onChange={() => setTestTargetType('emby')}
                    className="text-primary focus:ring-0"
                  />
                  <span>当前 Emby 服务器</span>
                </label>

                {/* Option: Custom URL */}
                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300 hover:text-white">
                  <input
                    type="radio"
                    name="testTarget"
                    value="custom"
                    checked={testTargetType === 'custom'}
                    onChange={() => setTestTargetType('custom')}
                    className="text-primary focus:ring-0"
                  />
                  <span>自定义网址</span>
                </label>
              </div>

              {/* Custom URL input field */}
              {testTargetType === 'custom' && (
                <div className="pt-1">
                  <input
                    type="text"
                    placeholder="输入测试网址，如 https://api.github.com"
                    value={customTestUrl}
                    onChange={(e) => setCustomTestUrl(e.target.value)}
                    className="w-full px-3 py-2 bg-[#12141a] border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary transition font-mono"
                  />
                </div>
              )}

              {testTargetType === 'emby' && currentServer && (
                <div className="text-[11px] text-gray-400 font-mono truncate">
                  目标节点：{currentServer.name} ({currentServer.url})
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="w-full py-2 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer"
            >
              {testing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span>正在发送探测请求...</span>
                </>
              ) : (
                <>
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>开始测试该代理配置</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/5 bg-[#12141a]/60 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20 transition cursor-pointer"
          >
            保存并应用配置
          </button>
        </div>
      </div>
    </div>
  );
};

export default NetworkProxyModal;
