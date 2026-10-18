import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Server,
  MessagesSquare,
  Sliders,
  PlaySquare,
  Globe,
  Info,
  Plus,
  Trash2,
  Edit2,
  Check,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Activity,
  Zap,
  RefreshCw,
  ExternalLink,
  Shield,
  Palette,
  Volume2,
  Cpu,
  FolderSync,
  Download,
  Upload,
  Copy,
  Lock,
  Unlock,
  FileText,
  CheckCheck,
  HardDrive,
  Cloud,
  Network,
  ShieldCheck,
  ArrowUpDown,
  FolderOpen,
  X,
} from 'lucide-react';
import { useAuthStore, SavedServer } from '../stores/useAuthStore';
import { useDanmuStore, DanmuServerEntry } from '../stores/useDanmuStore';
import { usePlayerStore, DanmakuColorMode } from '../stores/usePlayerStore';
import { useMediaStore } from '../stores/useMediaStore';
import { useSyncStore, SyncProviderType } from '../stores/useSyncStore';
import {
  exportLocalConfig,
  parseBackupPayload,
  applyConfigToStores,
  downloadBackupFile,
  revealBackupInFileManager,
  copyBackupToClipboard,
  NoctaBackupPayload,
  BackupFileDownloadResult,
  ConfigStats,
} from '../services/configBackupService';
import {
  testServerConnection,
  authenticateByName,
  normalizeServerUrl,
} from '../api/embyClient';
import { ProxyConfig, ProxyType, fetchSystemProxy } from '../api/http';

type TabKey = 'servers' | 'danmu' | 'danmaku_pref' | 'playback' | 'network' | 'sync' | 'about';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabKey) || 'servers';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    const tabParam = searchParams.get('tab') as TabKey;
    if (tabParam && ['servers', 'danmu', 'danmaku_pref', 'playback', 'network', 'sync', 'about'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  // Stores
  const {
    servers: embyServers,
    currentServerId,
    addOrUpdateServer,
    updateServer: updateEmbyServer,
    removeServer: removeEmbyServer,
    setCurrentServer: setEmbyCurrentServer,
    globalProxyConfig,
    updateGlobalProxyConfig,
    testProxyConnection,
  } = useAuthStore();

  const clearMediaCache = useMediaStore((s) => s.clearMediaCache);

  const {
    servers: danmuServers,
    activeServerId: activeDanmuServerId,
    addServer: addDanmuServer,
    updateServer: updateDanmuServer,
    removeServer: removeDanmuServer,
    setActiveServer: setActiveDanmuServer,
    testServerConnection: testDanmuServer,
  } = useDanmuStore();

  const {
    danmakuSettings,
    updateDanmakuSettings,
    engineType,
    setEngineType,
  } = usePlayerStore();

  // Emby 编辑/新增状态
  const [editingEmbyServer, setEditingEmbyServer] = useState<SavedServer | null>(null);
  const [isAddingEmby, setIsAddingEmby] = useState(false);
  const [embyFormName, setEmbyFormName] = useState('');
  const [embyFormUrl, setEmbyFormUrl] = useState('');
  const [embyFormUser, setEmbyFormUser] = useState('');
  const [embyFormPass, setEmbyFormPass] = useState('');
  const [embyFormError, setEmbyFormError] = useState<string | null>(null);
  const [embyTesting, setEmbyTesting] = useState(false);
  const [embyTestMsg, setEmbyTestMsg] = useState<string | null>(null);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});

  // 弹幕节点 编辑/新增状态
  const [editingDanmu, setEditingDanmu] = useState<DanmuServerEntry | null>(null);
  const [isAddingDanmu, setIsAddingDanmu] = useState(false);
  const [danmuFormName, setDanmuFormName] = useState('');
  const [danmuFormUrl, setDanmuFormUrl] = useState('');
  const [danmuFormPlatform, setDanmuFormPlatform] = useState('');
  const [danmuFormError, setDanmuFormError] = useState<string | null>(null);

  // 屏蔽词状态
  const [newBlockedWord, setNewBlockedWord] = useState('');

  // 代理配置表单状态
  const [proxyType, setProxyType] = useState<ProxyType>(globalProxyConfig.type || 'system');
  const [proxyUrl, setProxyUrl] = useState(globalProxyConfig.serverUrl || 'http://127.0.0.1:7890');
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{ ok: boolean; latency?: number; error?: string } | null>(null);
  type ProxyTestTarget = 'google' | 'emby' | 'custom';
  const [proxyTestTarget, setProxyTestTarget] = useState<ProxyTestTarget>('google');
  const [customProxyTestUrl, setCustomProxyTestUrl] = useState('');
  const currentEmbyServer = embyServers.find((s) => s.id === currentServerId) || embyServers[0] || null;

  // 切换 Emby 服务器
  const handleSwitchEmbyServer = (id: string) => {
    if (id === currentServerId) return;
    clearMediaCache();
    setEmbyCurrentServer(id);
  };

  // 密码可见性切换
  const togglePasswordReveal = (id: string) => {
    setRevealedPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 保存 Emby 表单
  const handleSaveEmbyServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!embyFormUrl.trim() || !embyFormUser.trim()) {
      setEmbyFormError('请填写完整的服务器地址和用户名');
      return;
    }

    setEmbyTesting(true);
    setEmbyFormError(null);

    const cleanUrl = normalizeServerUrl(embyFormUrl);
    const cleanUser = embyFormUser.trim();
    let authRes;

    try {
      authRes = await authenticateByName(cleanUrl, cleanUser, embyFormPass);
    } catch (err: any) {
      console.warn('保存服务器时连通验证失败，但仍然记录', err);
    }

    if (editingEmbyServer) {
      updateEmbyServer(editingEmbyServer.id, {
        name: embyFormName.trim() || 'Emby Server',
        url: cleanUrl,
        username: cleanUser,
        password: embyFormPass || editingEmbyServer.password,
        userId: authRes?.User?.Id || editingEmbyServer.userId,
        accessToken: authRes?.AccessToken || editingEmbyServer.accessToken,
        lastTestOk: !!authRes,
        lastTestError: authRes ? undefined : '连接或登录校验未通过',
        lastTestAt: Date.now(),
      });
      if (editingEmbyServer.id === currentServerId) {
        clearMediaCache();
      }
    } else {
      addOrUpdateServer({
        id: crypto.randomUUID(),
        name: embyFormName.trim() || 'Emby Server',
        url: cleanUrl,
        userId: authRes?.User?.Id || 'pending-auth',
        username: cleanUser,
        accessToken: authRes?.AccessToken || '',
        password: embyFormPass,
        lastTestOk: !!authRes,
        lastTestError: authRes ? undefined : '连接或登录校验未通过',
        lastTestAt: Date.now(),
      });
    }

    setEmbyTesting(false);
    setIsAddingEmby(false);
    setEditingEmbyServer(null);
  };

  // 保存 弹幕节点 表单
  const handleSaveDanmuServer = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = danmuFormUrl.trim();
    if (!cleanUrl) {
      setDanmuFormError('请输入服务地址');
      return;
    }
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      setDanmuFormError('服务地址必须以 http:// 或 https:// 开头');
      return;
    }

    const cleanName = danmuFormName.trim() || 'Danmu API 节点';

    if (editingDanmu) {
      updateDanmuServer(editingDanmu.id, {
        name: cleanName,
        baseUrl: cleanUrl,
        preferredPlatform: danmuFormPlatform.trim(),
      });
      testDanmuServer(editingDanmu.id);
    } else {
      const newId = addDanmuServer({
        name: cleanName,
        baseUrl: cleanUrl,
        preferredPlatform: danmuFormPlatform.trim(),
      });
      testDanmuServer(newId);
    }

    setIsAddingDanmu(false);
    setEditingDanmu(null);
  };

  // 添加屏蔽词
  const handleAddBlockedWord = (e: React.FormEvent) => {
    e.preventDefault();
    const word = newBlockedWord.trim();
    if (!word) return;
    if (danmakuSettings.blockedWords.includes(word)) {
      setNewBlockedWord('');
      return;
    }
    updateDanmakuSettings({
      blockedWords: [...danmakuSettings.blockedWords, word],
    });
    setNewBlockedWord('');
  };

  // 移除屏蔽词
  const handleRemoveBlockedWord = (word: string) => {
    updateDanmakuSettings({
      blockedWords: danmakuSettings.blockedWords.filter((w) => w !== word),
    });
  };

  // 保存全局代理
  const handleSaveProxy = (newType: ProxyType, newUrl?: string) => {
    setProxyType(newType);
    const cfg: ProxyConfig = {
      type: newType,
      serverUrl: newType === 'manual' || newType === 'http' || newType === 'socks5' ? newUrl || proxyUrl : undefined,
    };
    updateGlobalProxyConfig(cfg);
  };

  // 测试代理
  const handleTestProxy = async () => {
    let target = 'https://www.google.com/generate_204';
    if (proxyTestTarget === 'emby') {
      if (!currentEmbyServer) {
        setProxyTestResult({ ok: false, error: '未找到当前连接的 Emby 服务器' });
        return;
      }
      target = `${currentEmbyServer.url}/emby/System/Info/Public`;
    } else if (proxyTestTarget === 'custom') {
      const url = customProxyTestUrl.trim();
      if (!url) {
        setProxyTestResult({ ok: false, error: '请输入有效的自定义测试网址' });
        return;
      }
      target = url;
    }

    setProxyTesting(true);
    setProxyTestResult(null);
    try {
      const res = await testProxyConnection(
        {
          type: proxyType,
          serverUrl:
            proxyType === 'manual' || proxyType === 'http' || proxyType === 'socks5'
              ? proxyUrl
              : undefined,
        },
        target
      );
      setProxyTestResult(res);
    } catch (err: any) {
      setProxyTestResult({ ok: false, error: err?.message || '测试失败' });
    } finally {
      setProxyTesting(false);
    }
  };

  // 导出导入与多端同步状态
  const syncStore = useSyncStore();
  const [exportIncludeSecrets, setExportIncludeSecrets] = useState(true);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exporting, setExporting] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [importFileText, setImportFileText] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importPayloadPreview, setImportPayloadPreview] = useState<NoctaBackupPayload | null>(null);
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const [syncTesting, setSyncTesting] = useState(false);
  const [syncTestResult, setSyncTestResult] = useState<{
    ok: boolean;
    fileExists: boolean;
    latency: number;
    error?: string;
  } | null>(null);
  const [syncActionMsg, setSyncActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showSyncPassphrase, setShowSyncPassphrase] = useState(false);
  const [showSmbPassword, setShowSmbPassword] = useState(false);
  const [showWebDavPassword, setShowWebDavPassword] = useState(false);
  const [showS3Secret, setShowS3Secret] = useState(false);
  const [downloadResult, setDownloadResult] = useState<BackupFileDownloadResult | null>(null);
  const downloadToastTimerRef = React.useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (downloadToastTimerRef.current) {
        clearTimeout(downloadToastTimerRef.current);
      }
    };
  }, []);

  const handleDownloadExport = async () => {
    try {
      setExporting(true);
      const payload = await exportLocalConfig({
        includeSecrets: exportIncludeSecrets,
        passphrase: exportPassphrase.trim() || undefined,
      });
      const result = await downloadBackupFile(payload);
      setDownloadResult(result);

      if (downloadToastTimerRef.current) {
        clearTimeout(downloadToastTimerRef.current);
      }
      downloadToastTimerRef.current = window.setTimeout(() => {
        setDownloadResult(null);
      }, 7000);
    } catch (e: any) {
      alert(`导出备份文件失败: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleCopyExport = async () => {
    try {
      setExporting(true);
      const payload = await exportLocalConfig({
        includeSecrets: exportIncludeSecrets,
        passphrase: exportPassphrase.trim() || undefined,
      });
      await copyBackupToClipboard(payload);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    } catch (e: any) {
      alert(`复制失败: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError(null);
    setImportSuccessMsg(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportFileText(content);
      try {
        const parsed = JSON.parse(content);
        setImportPayloadPreview(parsed);
      } catch {
        setImportError('文件内容不是有效的 JSON 格式');
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    if (!importFileText) {
      setImportError('请先选择备份文件');
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportSuccessMsg(null);

    try {
      const { data } = await parseBackupPayload(
        importFileText,
        importPassphrase.trim() || undefined
      );
      const stats = applyConfigToStores(data, importMode);
      setImportSuccessMsg(
        `导入成功！已应用 ${stats.serverCount} 个服务器、${stats.danmuServerCount} 个弹幕节点、${stats.bindingCount} 个弹幕绑定`
      );
    } catch (err: any) {
      setImportError(err.message || '导入配置失败');
    } finally {
      setImporting(false);
    }
  };

  const handleTestSync = async () => {
    setSyncTesting(true);
    setSyncTestResult(null);
    setSyncActionMsg(null);
    try {
      const res = await syncStore.testConnection();
      setSyncTestResult(res);
    } catch (err: any) {
      setSyncTestResult({
        ok: false,
        fileExists: false,
        latency: 0,
        error: err.message || '测试失败',
      });
    } finally {
      setSyncTesting(false);
    }
  };

  const handleSyncNow = async (mode: 'smart_merge' | 'upload_only' | 'download_only') => {
    setSyncActionMsg(null);
    const res = await syncStore.syncNow(mode);
    setSyncActionMsg({ text: res.message, ok: res.success });
  };

  return (
    <div className="w-full min-h-full py-6 px-8 select-none">
      {/* 顶部标题栏 */}
      <div className="flex items-center space-x-4 mb-8">
        <button
          onClick={() => navigate('/')}
          className="p-2.5 rounded-full bg-surface hover:bg-white/10 text-gray-300 hover:text-white transition cursor-pointer flex-shrink-0"
          title="返回媒体库"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>系统设置</span>
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            集中管理 Emby 服务器、弹幕 API 节点、播放器内核与网络偏好
          </p>
        </div>
      </div>

      {/* 主体双栏布局 */}
      <div className="flex flex-col md:flex-row gap-6 max-w-6xl mx-auto">
        {/* 左侧导航栏 */}
        <div className="w-full md:w-60 flex-shrink-0 space-y-1">
          {[
            { id: 'servers', label: 'Emby 服务器', icon: Server },
            { id: 'danmu', label: '弹幕 API 节点', icon: MessagesSquare },
            { id: 'danmaku_pref', label: '弹幕偏好', icon: Sliders },
            { id: 'playback', label: '播放与内核', icon: PlaySquare },
            { id: 'network', label: '网络与代理', icon: Globe },
            { id: 'sync', label: '配置同步与备份', icon: FolderSync },
            { id: 'about', label: '关于 Nocta', icon: Info },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id as TabKey)}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer text-left ${
                  isActive
                    ? 'bg-primary text-white shadow-lg shadow-primary/20'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* 右侧面板容器 */}
        <div className="flex-1 bg-surface/70 border border-white/10 rounded-2xl p-6 min-h-[520px]">
          {/* 1. Emby 服务器设置面板 */}
          {activeTab === 'servers' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-base font-bold text-white">Emby / Jellyfin 服务器管理</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    支持配置多个家庭 NAS 或远程服务器，并可在此快速切换与测速
                  </p>
                </div>
                {!isAddingEmby && !editingEmbyServer && (
                  <button
                    onClick={() => {
                      setEmbyFormName('');
                      setEmbyFormUrl('');
                      setEmbyFormUser('');
                      setEmbyFormPass('');
                      setEmbyFormError(null);
                      setIsAddingEmby(true);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-medium transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加服务器</span>
                  </button>
                )}
              </div>

              {/* 新增或编辑表单 */}
              {(isAddingEmby || editingEmbyServer) && (
                <form
                  onSubmit={handleSaveEmbyServer}
                  className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-4"
                >
                  <h3 className="text-sm font-semibold text-white">
                    {editingEmbyServer ? '编辑服务器' : '添加新服务器'}
                  </h3>
                  {embyFormError && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-lg">
                      {embyFormError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">服务器名称</label>
                      <input
                        type="text"
                        value={embyFormName}
                        onChange={(e) => setEmbyFormName(e.target.value)}
                        placeholder="如：家中 NAS、影音库"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">
                        服务地址 (含端口与 http/https)
                      </label>
                      <input
                        type="text"
                        value={embyFormUrl}
                        onChange={(e) => setEmbyFormUrl(e.target.value)}
                        placeholder="如：http://192.168.1.100:8096"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">用户名</label>
                      <input
                        type="text"
                        value={embyFormUser}
                        onChange={(e) => setEmbyFormUser(e.target.value)}
                        placeholder="登录账号"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">密码</label>
                      <input
                        type="password"
                        value={embyFormPass}
                        onChange={(e) => setEmbyFormPass(e.target.value)}
                        placeholder="密码（保存在本地方便免密重连）"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingEmby(false);
                        setEditingEmbyServer(null);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs transition cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={embyTesting}
                      className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-medium transition cursor-pointer flex items-center space-x-1.5"
                    >
                      {embyTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      <span>保存服务器</span>
                    </button>
                  </div>
                </form>
              )}

              {/* 服务器列表卡片 */}
              <div className="space-y-3">
                {embyServers.map((server) => {
                  const isCurrent = server.id === currentServerId;
                  const isPassRevealed = revealedPasswords[server.id];
                  return (
                    <div
                      key={server.id}
                      className={`p-4 rounded-xl border transition ${
                        isCurrent
                          ? 'bg-primary/10 border-primary/40'
                          : 'bg-white/5 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              server.lastTestOk === false
                                ? 'bg-amber-400'
                                : server.lastTestOk === true
                                ? 'bg-emerald-400'
                                : 'bg-gray-500'
                            }`}
                          />
                          <div>
                            <div className="flex items-center space-x-2">
                              <h3 className="text-sm font-semibold text-white">{server.name}</h3>
                              {isCurrent && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/30 text-primary font-medium">
                                  当前活跃
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 space-x-2 font-mono">
                              <span>{server.url}</span>
                              <span className="text-gray-500">·</span>
                              <span>账号: {server.username}</span>
                              {server.password && (
                                <>
                                  <span className="text-gray-500">·</span>
                                  <span>
                                    密码: {isPassRevealed ? server.password : '••••••'}
                                  </span>
                                  <button
                                    onClick={() => togglePasswordReveal(server.id)}
                                    className="text-gray-400 hover:text-white inline-block align-middle ml-1"
                                    title="查看/隐藏密码"
                                  >
                                    {isPassRevealed ? (
                                      <EyeOff className="w-3 h-3 inline" />
                                    ) : (
                                      <Eye className="w-3 h-3 inline" />
                                    )}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          {!isCurrent && (
                            <button
                              onClick={() => handleSwitchEmbyServer(server.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white transition cursor-pointer"
                            >
                              使用此服务器
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingEmbyServer(server);
                              setEmbyFormName(server.name);
                              setEmbyFormUrl(server.url);
                              setEmbyFormUser(server.username);
                              setEmbyFormPass(server.password || '');
                              setEmbyFormError(null);
                              setIsAddingEmby(false);
                            }}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition cursor-pointer"
                            title="编辑"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {embyServers.length > 1 && (
                            <button
                              onClick={() => {
                                if (confirm(`确定要移除「${server.name}」吗？`)) {
                                  removeEmbyServer(server.id);
                                }
                              }}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition cursor-pointer"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. 弹幕 API 节点设置面板 */}
          {activeTab === 'danmu' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-base font-bold text-white">弹幕 API 节点设置</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    配置第三方 danmu_api 服务端节点，Token 需直接填写在 URL 地址末尾
                  </p>
                </div>
                {!isAddingDanmu && !editingDanmu && (
                  <button
                    onClick={() => {
                      setDanmuFormName('');
                      setDanmuFormUrl('http://127.0.0.1:9321/87654321');
                      setDanmuFormPlatform('');
                      setDanmuFormError(null);
                      setIsAddingDanmu(true);
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-medium transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加节点</span>
                  </button>
                )}
              </div>

              {/* 节点表单 */}
              {(isAddingDanmu || editingDanmu) && (
                <form
                  onSubmit={handleSaveDanmuServer}
                  className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-4"
                >
                  <h3 className="text-sm font-semibold text-white">
                    {editingDanmu ? '编辑弹幕节点' : '添加弹幕节点'}
                  </h3>
                  {danmuFormError && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-lg">
                      {danmuFormError}
                    </div>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">节点名称</label>
                      <input
                        type="text"
                        value={danmuFormName}
                        onChange={(e) => setDanmuFormName(e.target.value)}
                        placeholder="如：本地 Danmu API、VPS 节点"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">
                        服务地址 (必须以 http:// 开头，并在路径末尾附带 Token)
                      </label>
                      <input
                        type="text"
                        value={danmuFormUrl}
                        onChange={(e) => setDanmuFormUrl(e.target.value)}
                        placeholder="如：http://127.0.0.1:9321/87654321 或 http://vps:9321/my_token"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-400 block mb-1">
                        首选匹配平台 (可选)
                      </label>
                      <input
                        type="text"
                        value={danmuFormPlatform}
                        onChange={(e) => setDanmuFormPlatform(e.target.value)}
                        placeholder="留空自动匹配，或输入 bilibili1, qiyi, qq, youku"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingDanmu(false);
                        setEditingDanmu(null);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs transition cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-medium transition cursor-pointer"
                    >
                      保存节点
                    </button>
                  </div>
                </form>
              )}

              {/* 节点列表 */}
              <div className="space-y-3">
                {danmuServers.map((server) => {
                  const isActive = server.id === activeDanmuServerId;
                  return (
                    <div
                      key={server.id}
                      className={`p-4 rounded-xl border transition ${
                        isActive
                          ? 'bg-primary/10 border-primary/40'
                          : 'bg-white/5 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              server.status === 'ok'
                                ? 'bg-emerald-400'
                                : server.status === 'error'
                                ? 'bg-red-400'
                                : 'bg-gray-500'
                            }`}
                          />
                          <div>
                            <div className="flex items-center space-x-2">
                              <h3 className="text-sm font-semibold text-white">{server.name}</h3>
                              {isActive && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/30 text-primary font-medium">
                                  使用中
                                </span>
                              )}
                              {server.latency !== undefined && (
                                <span className="text-[10px] text-gray-400 font-mono">
                                  {server.latency} ms
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 font-mono">
                              {server.baseUrl}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => testDanmuServer(server.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-gray-300 hover:text-white transition cursor-pointer"
                            title="测速"
                          >
                            <Activity className="w-3.5 h-3.5 inline mr-1" />
                            测速
                          </button>
                          {!isActive && (
                            <button
                              onClick={() => setActiveDanmuServer(server.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-primary/80 hover:bg-primary text-xs text-white transition cursor-pointer"
                            >
                              启用
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingDanmu(server);
                              setDanmuFormName(server.name);
                              setDanmuFormUrl(server.baseUrl);
                              setDanmuFormPlatform(server.preferredPlatform || '');
                              setDanmuFormError(null);
                              setIsAddingDanmu(false);
                            }}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition cursor-pointer"
                            title="编辑"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {danmuServers.length > 1 && (
                            <button
                              onClick={() => {
                                if (confirm(`确定要移除「${server.name}」吗？`)) {
                                  removeDanmuServer(server.id);
                                }
                              }}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition cursor-pointer"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. 弹幕外观与偏好面板 */}
          {activeTab === 'danmaku_pref' && (
            <div className="space-y-6">
              <div className="border-b border-white/10 pb-4">
                <h2 className="text-base font-bold text-white">弹幕渲染与显示偏好</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  个性化配置全屏弹幕透明度、字号、滚动速度与色彩过滤
                </p>
              </div>

              {/* 弹幕常规参数 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>不透明度</span>
                    <span className="font-mono">{Math.round(danmakuSettings.opacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={Math.round(danmakuSettings.opacity * 100)}
                    onChange={(e) =>
                      updateDanmakuSettings({ opacity: Number(e.target.value) / 100 })
                    }
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>字体大小</span>
                    <span className="font-mono">{danmakuSettings.fontSize} px</span>
                  </div>
                  <input
                    type="range"
                    min="16"
                    max="36"
                    value={danmakuSettings.fontSize}
                    onChange={(e) =>
                      updateDanmakuSettings({ fontSize: Number(e.target.value) })
                    }
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>滚动速度</span>
                    <span className="font-mono">{danmakuSettings.speed}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={danmakuSettings.speed}
                    onChange={(e) =>
                      updateDanmakuSettings({ speed: Number(e.target.value) })
                    }
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>底部字幕避让间距</span>
                    <span className="font-mono">{danmakuSettings.bottomMargin} px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="120"
                    step="8"
                    value={danmakuSettings.bottomMargin}
                    onChange={(e) =>
                      updateDanmakuSettings({ bottomMargin: Number(e.target.value) })
                    }
                    className="w-full accent-primary cursor-pointer"
                  />
                </div>
              </div>

              {/* 色彩模式 */}
              <div className="space-y-3 pt-2">
                <label className="text-xs font-semibold text-white block">弹幕色彩模式</label>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      { id: 'vibrant', label: '绚丽彩色', desc: '保留源站全彩特效' },
                      { id: 'monochrome', label: '纯净白字', desc: '所有弹幕统一纯白' },
                      { id: 'blocked', label: '屏蔽彩弹', desc: '丢弃所有彩色弹幕' },
                    ] as const
                  ).map((m) => {
                    const isSelected = danmakuSettings.colorMode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => updateDanmakuSettings({ colorMode: m.id as DanmakuColorMode })}
                        className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                          isSelected
                            ? 'bg-primary/20 border-primary text-white'
                            : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/20'
                        }`}
                      >
                        <div className="text-xs font-semibold">{m.label}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{m.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 屏蔽词管理 */}
              <div className="space-y-3 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white">屏蔽词管理</label>
                  <span className="text-[11px] text-gray-400 font-mono">
                    已设 {danmakuSettings.blockedWords.length} 条
                  </span>
                </div>

                <form onSubmit={handleAddBlockedWord} className="flex gap-2">
                  <input
                    type="text"
                    value={newBlockedWord}
                    onChange={(e) => setNewBlockedWord(e.target.value)}
                    placeholder="输入要屏蔽的关键词并回车添加"
                    className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition cursor-pointer"
                  >
                    添加
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pt-1">
                  {danmakuSettings.blockedWords.map((word) => (
                    <span
                      key={word}
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300"
                    >
                      <span>{word}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveBlockedWord(word)}
                        className="text-gray-500 hover:text-red-400 cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {danmakuSettings.blockedWords.length === 0 && (
                    <span className="text-xs text-gray-500 italic">暂无屏蔽词</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 4. 播放器内核与渲染面板 */}
          {activeTab === 'playback' && (
            <div className="space-y-6">
              <div className="border-b border-white/10 pb-4">
                <h2 className="text-base font-bold text-white">播放内核与音画渲染</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  切换播放解码核心，享受原生硬解零转码高保真视听体验
                </p>
              </div>

              {/* 解码引擎切换 */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-white block">解码核心引擎</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div
                    onClick={() => setEngineType('mpv')}
                    className={`p-4 rounded-xl border transition cursor-pointer ${
                      engineType === 'mpv'
                        ? 'bg-primary/15 border-primary text-white shadow-lg shadow-primary/15'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Zap className="w-4 h-4 text-primary" />
                        <span className="text-sm font-bold">libmpv 原生硬解 (推荐)</span>
                      </div>
                      {engineType === 'mpv' && <CheckCircle2 className="w-4 h-4 text-primary" />}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                      基于底层 mpv-2 硬解引擎，支持 4K HDR、DTS-HD MA 与 Dolby Atmos 多声道直出，MKV 原始流 0 转码播放，NAS 与 CPU 负荷极低。
                    </p>
                  </div>

                  <div
                    onClick={() => setEngineType('html5')}
                    className={`p-4 rounded-xl border transition cursor-pointer ${
                      engineType === 'html5'
                        ? 'bg-primary/15 border-primary text-white shadow-lg shadow-primary/15'
                        : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Cpu className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-bold">HTML5 兼容模式</span>
                      </div>
                      {engineType === 'html5' && <CheckCircle2 className="w-4 h-4 text-primary" />}
                    </div>
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                      基于 Chromium / WebView2 原生 HTML5 播放器，MKV 等格式会由 Emby 轻量封装或转码为 MP4 播放，作为兼容回退。
                    </p>
                  </div>
                </div>
              </div>

              {/* 宽银幕贴底技术说明 */}
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2">
                <div className="flex items-center space-x-2 text-xs font-semibold text-gray-200">
                  <PlaySquare className="w-4 h-4 text-primary" />
                  <span>宽银幕画面沉浸贴底 (Bottom Alignment)</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  针对 2.35:1 / 2.39:1 / 21:9 宽银幕电影，Nocta 会智能将视频画面贴紧显示器底边，将全部多余黑边聚合在屏幕顶部作为专属弹幕滑行区，彻底消除弹幕对人物面部和字幕的遮挡。
                </p>
              </div>
            </div>
          )}

          {/* 5. 网络与代理面板 */}
          {activeTab === 'network' && (
            <div className="space-y-6">
              <div className="border-b border-white/10 pb-4">
                <h2 className="text-base font-bold text-white">网络与全局代理配置</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  配置用于 Emby 服务器访问与弹幕拉取的网络代理规则
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-semibold text-white block">代理模式</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { id: 'system', label: '跟随系统代理', desc: '读取系统全局或 PAC 代理' },
                    { id: 'direct', label: '直连模式', desc: '不走任何代理直接通信' },
                    { id: 'manual', label: '手动指定代理', desc: '指定本地 HTTP/SOCKS 端口' },
                  ].map((m) => {
                    const isSelected = proxyType === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSaveProxy(m.id as ProxyType)}
                        className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                          isSelected
                            ? 'bg-primary/20 border-primary text-white'
                            : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/20'
                        }`}
                      >
                        <div className="text-xs font-semibold">{m.label}</div>
                        <div className="text-[10px] text-gray-400 mt-1">{m.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {proxyType === 'manual' && (
                <div className="space-y-2 pt-2">
                  <label className="text-xs text-gray-300 block">代理服务器地址与端口 (如 HTTP / SOCKS5)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                      placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:10808"
                      className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                    />
                    <button
                      onClick={() => handleSaveProxy('manual', proxyUrl)}
                      className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-medium transition cursor-pointer"
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}

              {/* 连通性测试 */}
              <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-300">代理网络连通测试</span>
                  <button
                    onClick={handleTestProxy}
                    disabled={proxyTesting}
                    className="px-3.5 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs text-white font-medium transition cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                  >
                    {proxyTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>探测代理</span>
                  </button>
                </div>

                {/* 测速目标选择下拉框与自定义输入 */}
                <div className="space-y-2 pt-1">
                  <label className="text-xs text-gray-400 block">测试目标网址</label>
                  <select
                    value={proxyTestTarget}
                    onChange={(e) => setProxyTestTarget(e.target.value as ProxyTestTarget)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="google" className="bg-[#161922] text-white">
                      1. Google (全球外网连通性)
                    </option>
                    <option
                      value="emby"
                      disabled={!currentEmbyServer}
                      className="bg-[#161922] text-white"
                    >
                      2. 当前 Emby 服务器 {currentEmbyServer ? `(${currentEmbyServer.name || currentEmbyServer.url})` : '(尚未添加)'}
                    </option>
                    <option value="custom" className="bg-[#161922] text-white">
                      3. 自定义网址
                    </option>
                  </select>

                  {proxyTestTarget === 'custom' && (
                    <div className="pt-1">
                      <input
                        type="text"
                        value={customProxyTestUrl}
                        onChange={(e) => setCustomProxyTestUrl(e.target.value)}
                        placeholder="请输入测试网址，例如 https://api.github.com"
                        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                      />
                    </div>
                  )}
                </div>

                {proxyTestResult && (
                  <div
                    className={`text-xs p-2.5 rounded-lg border ${
                      proxyTestResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                    }`}
                  >
                    {proxyTestResult.ok
                      ? `代理连通正常 · 延迟 ${proxyTestResult.latency ?? 0} ms`
                      : `连接失败：${proxyTestResult.error || '无法连接'}`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. 配置同步与备份面板 */}
          {activeTab === 'sync' && (
            <div className="space-y-8">
              {/* 顶部标题区 */}
              <div className="border-b border-white/10 pb-4">
                <h2 className="text-base font-bold text-white flex items-center space-x-2">
                  <FolderSync className="w-5 h-5 text-primary" />
                  <span>配置同步与备份</span>
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  支持本地 JSON 配置文件导出导入（可脱敏与加密），并可通过 WebDAV、S3、SMB 实现全量配置的多设备无缝流转
                </p>
              </div>

              {/* 模块 1：本地文件备份与还原 */}
              <div className="space-y-4">
                <div className="flex items-center space-x-2 text-xs font-semibold text-white">
                  <HardDrive className="w-4 h-4 text-primary" />
                  <span>本地文件备份与恢复</span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 导出卡片 */}
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Download className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-semibold text-white">导出配置</h3>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-400">
                          JSON 格式
                        </span>
                      </div>

                      <p className="text-xs text-gray-400">
                        将 Emby 服务器列表、弹幕 API 节点、弹幕偏好、手动匹配绑定及画面布局导出为标准备份文件。
                      </p>

                      <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 space-y-1.5 text-[11px] text-gray-400">
                        <div className="flex justify-between">
                          <span>包含数据概览：</span>
                          <span className="text-gray-300 font-mono">
                            {embyServers.length} 个服务器 · {danmuServers.length} 个弹幕节点
                          </span>
                        </div>
                      </div>

                      {/* 脱敏开关 */}
                      <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={exportIncludeSecrets}
                          onChange={(e) => setExportIncludeSecrets(e.target.checked)}
                          className="rounded border-white/20 text-primary focus:ring-primary accent-primary"
                        />
                        <span>包含登录密码与 Token (若取消勾选则进行安全脱敏)</span>
                      </label>

                      {/* 可选密码加密 */}
                      <div>
                        <label className="text-[11px] text-gray-400 block mb-1">
                          备份文件加密密码 (可选，留空则为明文 JSON)
                        </label>
                        <input
                          type="password"
                          value={exportPassphrase}
                          onChange={(e) => setExportPassphrase(e.target.value)}
                          placeholder="设置文件密码 (AES-256-GCM 加密)"
                          className="w-full px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                        />
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-2 border-t border-white/5">
                      <button
                        onClick={handleDownloadExport}
                        disabled={exporting}
                        className={`flex-1 flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg text-white text-xs font-medium transition cursor-pointer ${
                          downloadResult
                            ? 'bg-emerald-600 hover:bg-emerald-500'
                            : 'bg-primary hover:bg-primary/90'
                        }`}
                      >
                        {downloadResult ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-white" />
                            <span>下载完成并已打开</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>下载备份文件</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleCopyExport}
                        disabled={exporting}
                        className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white text-xs font-medium transition cursor-pointer flex items-center space-x-1"
                        title="复制 JSON 文本"
                      >
                        {copiedToast ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>复制</span>
                          </>
                        )}
                      </button>
                    </div>

                    {downloadResult && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2 text-xs animate-in fade-in slide-in-from-top-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                            <span>备份文件下载成功</span>
                          </div>
                          <button
                            onClick={() => setDownloadResult(null)}
                            className="text-gray-400 hover:text-white transition p-0.5 cursor-pointer"
                            title="关闭提示"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div
                          className="text-gray-200 font-mono text-[11px] truncate bg-black/30 px-2 py-1 rounded"
                          title={downloadResult.filePath || downloadResult.fileName}
                        >
                          {downloadResult.fileName}
                        </div>
                        {downloadResult.directory && (
                          <div className="text-gray-400 text-[10px] truncate" title={downloadResult.directory}>
                            保存目录: {downloadResult.directory}
                          </div>
                        )}
                        <div className="pt-1.5 flex items-center justify-between border-t border-emerald-500/20 text-[11px]">
                          <span className="text-emerald-300/90 text-[10px]">
                            {downloadResult.openedFolder ? '已自动打开下载文件夹' : '文件已保存至下载目录'}
                          </span>
                          {downloadResult.filePath && (
                            <button
                              onClick={() => revealBackupInFileManager(downloadResult.directory || downloadResult.filePath!)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-medium transition flex items-center space-x-1 cursor-pointer"
                              title="打开下载目录"
                            >
                              <FolderOpen className="w-3 h-3" />
                              <span>打开下载目录</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 导入卡片 */}
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Upload className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-semibold text-white">导入配置</h3>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-400">
                          本地恢复
                        </span>
                      </div>

                      {/* 隐藏的 input[file] */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={handleFileChange}
                        className="hidden"
                      />

                      {/* 文件选择区 */}
                      {!importFileText ? (
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="border border-dashed border-white/20 hover:border-primary/60 rounded-xl p-5 text-center cursor-pointer transition bg-black/20 hover:bg-black/30 flex flex-col items-center justify-center space-y-2"
                        >
                          <FileText className="w-6 h-6 text-gray-400" />
                          <div className="text-xs text-gray-300">
                            点击选择备份文件，或将 <span className="text-primary font-mono">.json</span> 拖入此处
                          </div>
                          <div className="text-[10px] text-gray-500">仅支持 Nocta 导出的有效配置备份文件</div>
                        </div>
                      ) : (
                        <div className="space-y-3 bg-black/30 border border-white/10 rounded-xl p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2 truncate">
                              <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                              <span className="text-xs text-white truncate font-medium">
                                {importFileName}
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                setImportFileText(null);
                                setImportFileName('');
                                setImportPayloadPreview(null);
                                setImportError(null);
                                setImportSuccessMsg(null);
                              }}
                              className="text-[11px] text-gray-400 hover:text-white underline cursor-pointer"
                            >
                              重选
                            </button>
                          </div>

                          {importPayloadPreview?.encrypted && (
                            <div className="flex items-center space-x-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2 rounded-lg">
                              <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>该文件为加密备份，需输入密码解密</span>
                            </div>
                          )}

                          {importPayloadPreview?.encrypted && (
                            <div>
                              <label className="text-[11px] text-gray-400 block mb-1">解密密码</label>
                              <input
                                type="password"
                                value={importPassphrase}
                                onChange={(e) => setImportPassphrase(e.target.value)}
                                placeholder="输入该备份文件的加密密码"
                                className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                              />
                            </div>
                          )}

                          {/* 导入模式 */}
                          <div className="space-y-1 pt-1">
                            <label className="text-[11px] text-gray-400 block">导入模式</label>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => setImportMode('merge')}
                                className={`px-2.5 py-1.5 rounded-lg border text-left transition cursor-pointer ${
                                  importMode === 'merge'
                                    ? 'bg-primary/20 border-primary text-white'
                                    : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                                }`}
                              >
                                <div className="font-semibold text-[11px]">智能合并 (推荐)</div>
                                <div className="text-[9px] text-gray-400 mt-0.5">保留并整合现有项</div>
                              </button>
                              <button
                                type="button"
                                onClick={() => setImportMode('replace')}
                                className={`px-2.5 py-1.5 rounded-lg border text-left transition cursor-pointer ${
                                  importMode === 'replace'
                                    ? 'bg-red-500/20 border-red-500 text-white'
                                    : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                                }`}
                              >
                                <div className="font-semibold text-[11px]">全量覆盖</div>
                                <div className="text-[9px] text-gray-400 mt-0.5">彻底替换本机全部项</div>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {importError && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-2.5 rounded-lg">
                          {importError}
                        </div>
                      )}
                      {importSuccessMsg && (
                        <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-lg">
                          {importSuccessMsg}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-white/5">
                      <button
                        onClick={handleExecuteImport}
                        disabled={!importFileText || importing}
                        className={`w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                          importFileText
                            ? 'bg-primary hover:bg-primary/90 text-white'
                            : 'bg-white/5 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        {importing ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>正在导入...</span>
                          </>
                        ) : (
                          <>
                            <CheckCheck className="w-3.5 h-3.5" />
                            <span>确认执行导入</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 模块 2：多端远程同步 (WebDAV / S3 / SMB) */}
              <div className="space-y-4 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-white/10 pt-6">
                  <div>
                    <div className="flex items-center space-x-2 text-xs font-semibold text-white">
                      <Cloud className="w-4 h-4 text-primary" />
                      <span>多端远程同步 (Multi-Device Sync)</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      通过云端或局域网存储在手机、平板、HTPC 与 PC 间自动保持配置同步
                    </p>
                  </div>

                  <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncStore.autoSyncOnStartup}
                        onChange={(e) =>
                          syncStore.updateSyncConfig({ autoSyncOnStartup: e.target.checked })
                        }
                        className="rounded border-white/20 text-primary focus:ring-primary accent-primary"
                      />
                      <span>启动时自动同步</span>
                    </label>

                    <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncStore.enabled}
                        onChange={(e) => syncStore.updateSyncConfig({ enabled: e.target.checked })}
                        className="rounded border-white/20 text-primary focus:ring-primary accent-primary"
                      />
                      <span className="font-semibold text-white">启用配置同步</span>
                    </label>
                  </div>
                </div>

                {/* 协议选择标签页 */}
                <div className="flex items-center space-x-2 border-b border-white/10 pb-2">
                  {[
                    { id: 'webdav', label: 'WebDAV 网盘', desc: '坚果云 / Nextcloud / Alist' },
                    { id: 's3', label: 'S3 对象存储', desc: 'AWS / Cloudflare R2 / MinIO' },
                    { id: 'smb', label: 'SMB 局域网共享', desc: '家庭 NAS / Windows 共享' },
                  ].map((tab) => {
                    const isSelected = syncStore.provider === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() =>
                          syncStore.updateSyncConfig({ provider: tab.id as SyncProviderType })
                        }
                        className={`px-3.5 py-2 rounded-xl text-xs font-medium transition cursor-pointer text-left ${
                          isSelected
                            ? 'bg-primary text-white shadow-md shadow-primary/20'
                            : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <div className="font-semibold">{tab.label}</div>
                        <div className={`text-[9px] mt-0.5 ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                          {tab.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* 对应协议表单 */}
                <div className="bg-black/30 border border-white/10 rounded-xl p-5 space-y-4">
                  {/* WebDAV 表单 */}
                  {syncStore.provider === 'webdav' && (
                    <div className="space-y-4">
                      <div className="text-xs text-gray-400">
                        支持任意兼容标准 WebDAV 的网盘服务（坚果云、Nextcloud、Alist 等）。
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="text-[11px] text-gray-400 block mb-1">
                            WebDAV 目录地址 (URL)
                          </label>
                          <input
                            type="text"
                            value={syncStore.webdav.url}
                            onChange={(e) => syncStore.updateWebDavConfig({ url: e.target.value })}
                            placeholder="如：https://dav.jianguoyun.com/dav/nocta/ 或 http://192.168.1.100:5244/dav/nocta/"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">用户名 / 账号</label>
                          <input
                            type="text"
                            value={syncStore.webdav.username}
                            onChange={(e) =>
                              syncStore.updateWebDavConfig({ username: e.target.value })
                            }
                            placeholder="如：user@example.com"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[11px] text-gray-400">密码 / 应用专有密码</label>
                            <button
                              type="button"
                              onClick={() => setShowWebDavPassword(!showWebDavPassword)}
                              className="text-[10px] text-gray-400 hover:text-white"
                            >
                              {showWebDavPassword ? '隐藏' : '显示'}
                            </button>
                          </div>
                          <input
                            type={showWebDavPassword ? 'text' : 'password'}
                            value={syncStore.webdav.password || ''}
                            onChange={(e) =>
                              syncStore.updateWebDavConfig({ password: e.target.value })
                            }
                            placeholder="网盘密码或 WebDAV 授权密码"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">远端同步文件名</label>
                          <input
                            type="text"
                            value={syncStore.webdav.fileName || 'nocta-sync.json'}
                            onChange={(e) =>
                              syncStore.updateWebDavConfig({ fileName: e.target.value })
                            }
                            placeholder="nocta-sync.json"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* S3 表单 */}
                  {syncStore.provider === 's3' && (
                    <div className="space-y-4">
                      <div className="text-xs text-gray-400">
                        兼容 AWS S3、Cloudflare R2、MinIO、阿里云 OSS 及腾讯云 COS 等兼容 S3 的对象存储服务。
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="text-[11px] text-gray-400 block mb-1">
                            S3 服务端点 (Endpoint URL)
                          </label>
                          <input
                            type="text"
                            value={syncStore.s3.endpoint}
                            onChange={(e) => syncStore.updateS3Config({ endpoint: e.target.value })}
                            placeholder="如：https://<account>.r2.cloudflarestorage.com 或 http://192.168.1.100:9000"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">Bucket 存储桶名称</label>
                          <input
                            type="text"
                            value={syncStore.s3.bucket}
                            onChange={(e) => syncStore.updateS3Config({ bucket: e.target.value })}
                            placeholder="如：nocta-sync"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">区域 (Region)</label>
                          <input
                            type="text"
                            value={syncStore.s3.region || 'auto'}
                            onChange={(e) => syncStore.updateS3Config({ region: e.target.value })}
                            placeholder="auto 或 us-east-1"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">Access Key ID</label>
                          <input
                            type="text"
                            value={syncStore.s3.accessKeyId}
                            onChange={(e) =>
                              syncStore.updateS3Config({ accessKeyId: e.target.value })
                            }
                            placeholder="S3 访问密钥 ID"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[11px] text-gray-400">Secret Access Key</label>
                            <button
                              type="button"
                              onClick={() => setShowS3Secret(!showS3Secret)}
                              className="text-[10px] text-gray-400 hover:text-white"
                            >
                              {showS3Secret ? '隐藏' : '显示'}
                            </button>
                          </div>
                          <input
                            type={showS3Secret ? 'text' : 'password'}
                            value={syncStore.s3.secretAccessKey}
                            onChange={(e) =>
                              syncStore.updateS3Config({ secretAccessKey: e.target.value })
                            }
                            placeholder="S3 私有访问秘钥"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">路径前缀 (Prefix，可选)</label>
                          <input
                            type="text"
                            value={syncStore.s3.prefix || 'nocta/'}
                            onChange={(e) => syncStore.updateS3Config({ prefix: e.target.value })}
                            placeholder="nocta/"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">远端同步文件名</label>
                          <input
                            type="text"
                            value={syncStore.s3.fileName || 'nocta-sync.json'}
                            onChange={(e) => syncStore.updateS3Config({ fileName: e.target.value })}
                            placeholder="nocta-sync.json"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SMB 表单 */}
                  {syncStore.provider === 'smb' && (
                    <div className="space-y-4">
                      <div className="text-xs text-gray-400">
                        支持局域网 NAS (群晖、极空间、威联通、TrueNAS) 及 Windows 网络文件共享。
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">主机名或 IP 地址</label>
                          <input
                            type="text"
                            value={syncStore.smb.host}
                            onChange={(e) => syncStore.updateSmbConfig({ host: e.target.value })}
                            placeholder="如：192.168.1.100 或 nas.local"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">共享文件夹名称 (Share)</label>
                          <input
                            type="text"
                            value={syncStore.smb.share}
                            onChange={(e) => syncStore.updateSmbConfig({ share: e.target.value })}
                            placeholder="如：share 或 media 或 backup"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">子目录相对路径 (Path，可选)</label>
                          <input
                            type="text"
                            value={syncStore.smb.path || 'nocta'}
                            onChange={(e) => syncStore.updateSmbConfig({ path: e.target.value })}
                            placeholder="nocta"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">用户名 (可选，匿名可留空)</label>
                          <input
                            type="text"
                            value={syncStore.smb.username || ''}
                            onChange={(e) =>
                              syncStore.updateSmbConfig({ username: e.target.value })
                            }
                            placeholder="NAS 账号或 Windows 账号"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                          />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[11px] text-gray-400">密码 (可选)</label>
                            <button
                              type="button"
                              onClick={() => setShowSmbPassword(!showSmbPassword)}
                              className="text-[10px] text-gray-400 hover:text-white"
                            >
                              {showSmbPassword ? '隐藏' : '显示'}
                            </button>
                          </div>
                          <input
                            type={showSmbPassword ? 'text' : 'password'}
                            value={syncStore.smb.password || ''}
                            onChange={(e) =>
                              syncStore.updateSmbConfig({ password: e.target.value })
                            }
                            placeholder="SMB 共享登录密码"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-400 block mb-1">远端同步文件名</label>
                          <input
                            type="text"
                            value={syncStore.smb.fileName || 'nocta-sync.json'}
                            onChange={(e) => syncStore.updateSmbConfig({ fileName: e.target.value })}
                            placeholder="nocta-sync.json"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 端到端加密设置 (全协议共享) */}
                  <div className="border-t border-white/10 pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 text-xs font-semibold text-white">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>端到端同步加密密码 (Passphrase，推荐设置)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowSyncPassphrase(!showSyncPassphrase)}
                        className="text-[11px] text-gray-400 hover:text-white"
                      >
                        {showSyncPassphrase ? '隐藏' : '显示'}
                      </button>
                    </div>

                    <p className="text-[11px] text-gray-400">
                      设置密码后，配置数据在离开本机前将由系统通过 <span className="text-white font-mono">AES-256-GCM</span> 强加密，云端仅存放密文，彻底保障 Emby 账号密码与 Token 绝不外泄。多台设备同步需填写相同的密码。
                    </p>

                    <input
                      type={showSyncPassphrase ? 'text' : 'password'}
                      value={syncStore.encryptionPassphrase}
                      onChange={(e) =>
                        syncStore.updateSyncConfig({ encryptionPassphrase: e.target.value })
                      }
                      placeholder="设置或填写同步解密密码 (留空则传输明文 JSON)"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary font-mono"
                    />
                  </div>
                </div>

                {/* 测试连接反馈与操作控制台 */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-400">同步状态：</span>
                        {syncStore.lastSyncStatus === 'success' && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                            同步正常
                          </span>
                        )}
                        {syncStore.lastSyncStatus === 'error' && (
                          <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-semibold">
                            上次失败
                          </span>
                        )}
                        {syncStore.lastSyncStatus === 'syncing' && (
                          <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold animate-pulse">
                            正在同步
                          </span>
                        )}
                        {syncStore.lastSyncStatus === 'idle' && (
                          <span className="px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400 text-[10px]">
                            尚未同步
                          </span>
                        )}
                        {syncStore.lastSyncTime && (
                          <span className="text-[10px] text-gray-500">
                            {new Date(syncStore.lastSyncTime).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {syncStore.lastSyncMessage && (
                        <div className="text-[11px] text-gray-400">{syncStore.lastSyncMessage}</div>
                      )}
                    </div>

                    <button
                      onClick={handleTestSync}
                      disabled={syncTesting}
                      className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white transition cursor-pointer flex items-center space-x-1.5 self-start sm:self-center"
                    >
                      {syncTesting ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Activity className="w-3.5 h-3.5" />
                      )}
                      <span>测试远程连接</span>
                    </button>
                  </div>

                  {syncTestResult && (
                    <div
                      className={`text-xs p-3 rounded-lg border ${
                        syncTestResult.ok
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/10 border-red-500/20 text-red-400'
                      }`}
                    >
                      {syncTestResult.ok
                        ? `连接成功 · 延迟 ${syncTestResult.latency} ms · 远程文件：${
                            syncTestResult.fileExists ? '已存在' : '尚未创建 (首次同步将自动初始化)'
                          }`
                        : `连接失败：${syncTestResult.error}`}
                    </div>
                  )}

                  {syncActionMsg && (
                    <div
                      className={`text-xs p-3 rounded-lg border ${
                        syncActionMsg.ok
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/10 border-red-500/20 text-red-400'
                      }`}
                    >
                      {syncActionMsg.text}
                    </div>
                  )}

                  {/* 核心同步操作按钮栏 */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                    <button
                      onClick={() => handleSyncNow('smart_merge')}
                      disabled={syncStore.isSyncing}
                      className="flex-1 min-w-[180px] flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold shadow-lg shadow-primary/25 transition cursor-pointer"
                    >
                      {syncStore.isSyncing ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <ArrowUpDown className="w-4 h-4" />
                      )}
                      <span>立即同步 (双向智能合并)</span>
                    </button>

                    <button
                      onClick={() => {
                        if (confirm('确定要将本机配置强制推送到远端覆盖吗？')) {
                          handleSyncNow('upload_only');
                        }
                      }}
                      disabled={syncStore.isSyncing}
                      className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-medium transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>上传覆盖远程</span>
                    </button>

                    <button
                      onClick={() => {
                        if (confirm('确定要从远端全量拉取并覆盖本机所有配置吗？')) {
                          handleSyncNow('download_only');
                        }
                      }}
                      disabled={syncStore.isSyncing}
                      className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-medium transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>从远程拉取覆盖</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 7. 关于 Nocta 面板 */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              <div className="flex items-center space-x-4 border-b border-white/10 pb-6">
                <img
                  src="/app-icon.svg"
                  alt="Nocta"
                  className="w-16 h-16 rounded-2xl p-1 bg-white/5 border border-white/10"
                />
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                    <span>Nocta · 夜幕</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300 font-mono font-normal">
                      v0.1.0-alpha.2
                    </span>
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">
                    沉浸式暗色私人影院客户端 · 深度集成 Emby/Jellyfin 与高性能全网弹幕
                  </p>
                </div>
              </div>

              {/* 快捷键速查表 */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-white">快捷键指南</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
                  {[
                    { key: '空格 (Space)', desc: '播放 / 暂停' },
                    { key: 'D', desc: '弹幕显示 / 隐藏' },
                    { key: 'F', desc: '全屏模式切换' },
                    { key: 'Ctrl + K', desc: '全局聚合搜索' },
                    { key: '← / →', desc: '快退 / 快进 5 秒' },
                    { key: '↑ / ↓', desc: '音量增加 / 减小' },
                  ].map((s) => (
                    <div
                      key={s.key}
                      className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between"
                    >
                      <span className="font-mono text-gray-300">{s.key}</span>
                      <span className="text-gray-500">{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 项目与技术架构 */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2 text-xs text-gray-400 leading-relaxed">
                <p>
                  <strong>技术栈架构</strong>：Tauri 2.0 + React 18 + TypeScript + libmpv 原生硬件解码 + Canvas 弹幕引擎。
                </p>
                <p>
                  <strong>开源仓库</strong>：
                  <a
                    href="https://github.com/wade6716/Nocta"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline ml-1 inline-flex items-center space-x-1"
                  >
                    <span>github.com/wade6716/Nocta</span>
                    <ExternalLink className="w-3 h-3 inline" />
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 备份下载成功浮动 Toast (右上角常驻反馈，即使滚动也能清晰看到) */}
      {downloadResult && (
        <div className="fixed top-8 right-8 z-50 max-w-sm bg-[#12151d]/95 backdrop-blur-xl border border-emerald-500/40 text-white text-xs p-3.5 rounded-2xl shadow-2xl flex items-start space-x-3 animate-in fade-in slide-in-from-top-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">备份文件导出成功</span>
              <button
                onClick={() => setDownloadResult(null)}
                className="text-gray-400 hover:text-white transition p-0.5 ml-2 cursor-pointer"
                title="关闭提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div
              className="text-gray-300 font-mono text-[11px] truncate mt-1 bg-black/40 px-2 py-0.5 rounded"
              title={downloadResult.filePath || downloadResult.fileName}
            >
              {downloadResult.fileName}
            </div>
            <p className="text-gray-400 text-[10px] mt-1 leading-snug">
              {downloadResult.openedFolder
                ? '已自动在系统文件管理器中打开下载目录'
                : '文件已保存至系统默认下载目录'}
            </p>
            {downloadResult.filePath && (
              <div className="mt-2.5 flex items-center space-x-2">
                <button
                  onClick={() => revealBackupInFileManager(downloadResult.directory || downloadResult.filePath!)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-medium transition flex items-center space-x-1 cursor-pointer border border-emerald-500/30"
                  title="打开下载目录"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>打开下载目录</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
