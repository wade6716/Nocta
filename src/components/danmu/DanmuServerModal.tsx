import React, { useState } from 'react';
import {
  X,
  Server,
  Plus,
  Trash2,
  CheckCircle2,
  Activity,
  AlertCircle,
  Edit2,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { useDanmuStore, DanmuServerEntry } from '../../stores/useDanmuStore';

interface DanmuServerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DanmuServerModal: React.FC<DanmuServerModalProps> = ({ isOpen, onClose }) => {
  const {
    servers,
    activeServerId,
    addServer,
    updateServer,
    removeServer,
    setActiveServer,
    testServerConnection,
  } = useDanmuStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [preferredPlatform, setPreferredPlatform] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleOpenAdd = () => {
    setName('');
    setBaseUrl('http://127.0.0.1:9321/87654321');
    setPreferredPlatform('');
    setFormError(null);
    setEditingId(null);
    setIsEditing(true);
  };

  const handleOpenEdit = (server: DanmuServerEntry) => {
    setName(server.name);
    setBaseUrl(server.baseUrl);
    setPreferredPlatform(server.preferredPlatform || '');
    setFormError(null);
    setEditingId(server.id);
    setIsEditing(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = baseUrl.trim();
    if (!cleanUrl) {
      setFormError('请输入服务地址');
      return;
    }
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      setFormError('服务地址必须以 http:// 或 https:// 开头');
      return;
    }

    const cleanName = name.trim() || 'Danmu API 节点';

    if (editingId) {
      updateServer(editingId, {
        name: cleanName,
        baseUrl: cleanUrl,
        preferredPlatform: preferredPlatform.trim(),
      });
    } else {
      const newId = addServer({
        name: cleanName,
        baseUrl: cleanUrl,
        preferredPlatform: preferredPlatform.trim(),
      });
      // Test immediately
      testServerConnection(newId);
    }

    setIsEditing(false);
    setEditingId(null);
  };

  const handleTest = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      setTestingId(id);
      await testServerConnection(id);
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (servers.length <= 1) {
      alert('至少需要保留一个弹幕节点');
      return;
    }
    if (confirm('确定要删除该弹幕服务器节点吗？')) {
      removeServer(id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="relative w-full max-w-xl bg-[#161922] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center space-x-2.5">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-white">弹幕 API 节点设置</h2>
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
              客户端不捆绑任何服务端程序，仅作为纯 HTTP 消费者。若您的 <code>danmu_api</code> 开启了 Token 保护，请直接将 Token 包含在地址中（例如 <code>http://127.0.0.1:9321/87654321</code> 或 <code>http://vps:9321/your_token</code>），支持随时测速与切换主用。
            </span>
          </div>

          {!isEditing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  已配置节点列表 ({servers.length})
                </span>
                <button
                  onClick={handleOpenAdd}
                  className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition flex items-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加节点</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {servers.map((s) => {
                  const isActive = s.id === activeServerId;
                  const isTesting = testingId === s.id || s.status === 'testing';

                  return (
                    <div
                      key={s.id}
                      onClick={() => setActiveServer(s.id)}
                      className={`p-4 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                        isActive
                          ? 'bg-primary/10 border-primary/40 shadow-lg shadow-primary/5'
                          : 'bg-white/5 border-white/5 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0 pr-3">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            isActive ? 'border-primary bg-primary' : 'border-gray-500'
                          }`}
                        >
                          {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-white truncate">{s.name}</span>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-semibold">
                                当前主用
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 font-mono truncate mt-0.5">
                            {s.baseUrl}
                          </p>
                        </div>
                      </div>

                      {/* Right controls */}
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        {/* Latency badge */}
                        {s.latency !== undefined && s.status === 'ok' && (
                          <span className="text-[11px] font-mono text-green-400 bg-green-500/10 px-2 py-0.5 rounded-md">
                            {s.latency} ms
                          </span>
                        )}
                        {s.status === 'error' && (
                          <span className="text-[11px] font-mono text-red-400 bg-red-500/10 px-2 py-0.5 rounded-md flex items-center space-x-1">
                            <AlertCircle className="w-3 h-3" />
                            <span>离线</span>
                          </span>
                        )}

                        {/* Ping button */}
                        <button
                          onClick={(e) => handleTest(s.id, e)}
                          disabled={isTesting}
                          title="测试连通性与延迟"
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                        >
                          <Activity
                            className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-primary' : ''}`}
                          />
                        </button>

                        {/* Edit button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(s);
                          }}
                          title="编辑节点"
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete button */}
                        {servers.length > 1 && (
                          <button
                            onClick={(e) => handleDelete(s.id, e)}
                            title="删除节点"
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Edit / Add Form */
            <form onSubmit={handleSaveForm} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-sm font-semibold text-white">
                  {editingId ? '编辑弹幕节点' : '新增弹幕节点'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  取消
                </button>
              </div>

              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                  {formError}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">节点名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如: 本地自建 / 家庭NAS / VPS主力"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">
                  服务地址 (若服务端配置了 Token 请直接写在地址末尾)
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="如: http://127.0.0.1:9321/87654321 或 http://vps:9321/your_token"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-primary"
                />
                <p className="text-[11px] text-gray-500">
                  提示：无需单独填写 Token，直接作为 URL 路径的一部分填写即可（如 <code>http://127.0.0.1:9321/87654321</code>）。无 Token 则直接填主机与端口。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-gray-300 font-medium">优先匹配平台</label>
                <select
                  value={preferredPlatform}
                  onChange={(e) => setPreferredPlatform(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                >
                  <option value="">自动最优匹配 (推荐)</option>
                  <option value="bilibili1">哔哩哔哩 (Bilibili)</option>
                  <option value="qiyi">爱奇艺 (iQiyi)</option>
                  <option value="qq">腾讯视频 (Tencent)</option>
                  <option value="youku">优酷视频 (Youku)</option>
                  <option value="bahamut">巴哈姆特动画疯</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition"
                >
                  保存节点
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default DanmuServerModal;
