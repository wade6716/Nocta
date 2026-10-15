import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  Link as LinkIcon,
  Clock,
  Palette,
  Sliders,
  Plus,
  Trash2,
  CheckCircle2,
  Tv,
  Server,
  Layers,
  Sparkles,
  RefreshCw,
  Unlink,
  BookmarkCheck,
  AlertTriangle,
  ArrowDownToLine,
  Globe,
} from 'lucide-react';
import {
  DanmuAnimeSearchResult,
  searchDanmuAnime,
  getDanmuBangumiEpisodes,
  fetchCommentsById,
  fetchCommentsByVideoUrl,
  RawDanmuComment,
} from '../../api/danmuClient';
import { MpvDanmakuBridge } from './MpvDanmakuBridge';
import { usePlayerStore, DanmakuColorMode } from '../../stores/usePlayerStore';
import { useDanmuStore } from '../../stores/useDanmuStore';
import { DanmuServerModal } from '../danmu/DanmuServerModal';
import { NetworkProxyModal } from '../settings/NetworkProxyModal';

interface DanmakuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bridge: MpvDanmakuBridge;
  itemId: string;
  seriesId?: string;
  itemTitle?: string;
  seriesName?: string;
  layoutKey?: string;
  videoAspectRatio?: number;
  isWidescreen?: boolean;
  currentMatchedTitle?: string;
  sourceCommentCount?: number;
  sourceDuration?: number;
  videoDuration?: number;
  onCommentsLoaded: (
    comments: RawDanmuComment[],
    sourceDuration?: number,
    meta?: { animeTitle: string; episodeTitle: string; episodeId: number | string }
  ) => void;
  onReAutoMatch?: () => void;
}

export const DanmakuDrawer: React.FC<DanmakuDrawerProps> = ({
  isOpen,
  onClose,
  bridge,
  itemId,
  seriesId,
  itemTitle = '',
  seriesName = '',
  layoutKey,
  videoAspectRatio,
  isWidescreen = false,
  currentMatchedTitle,
  sourceCommentCount = 0,
  sourceDuration,
  videoDuration,
  onCommentsLoaded,
  onReAutoMatch,
}) => {
  const [activeTab, setActiveTab] = useState<'match' | 'time' | 'style'>('match');
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);

  // Danmu servers store
  const { servers, activeServerId, getActiveServer } = useDanmuStore();
  const activeServer = getActiveServer();

  // Search state
  const defaultKeyword = seriesName || itemTitle.replace(/S\d+E\d+/i, '').trim();
  const [searchKeyword, setSearchKeyword] = useState(defaultKeyword);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DanmuAnimeSearchResult[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<DanmuAnimeSearchResult | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [directUrl, setDirectUrl] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [bindSuccessToast, setBindSuccessToast] = useState<string | null>(null);

  // Store
  const danmakuSettings = usePlayerStore((s) => s.danmakuSettings);
  const updateDanmakuSettings = usePlayerStore((s) => s.updateDanmakuSettings);
  const setItemOffset = usePlayerStore((s) => s.setItemOffset);
  const itemOffsets = usePlayerStore((s) => s.itemOffsets);
  const danmakuBindings = usePlayerStore((s) => s.danmakuBindings);
  const bindDanmaku = usePlayerStore((s) => s.bindDanmaku);
  const unbindDanmaku = usePlayerStore((s) => s.unbindDanmaku);
  const videoLayouts = usePlayerStore((s) => s.videoLayouts);
  const setVideoLayout = usePlayerStore((s) => s.setVideoLayout);
  const resetVideoLayout = usePlayerStore((s) => s.resetVideoLayout);
  const engineType = usePlayerStore((s) => s.engineType);
  const setEngineType = usePlayerStore((s) => s.setEngineType);

  const effectiveLayoutKey = layoutKey || (seriesId ? `series_${seriesId}` : `item_${itemId}`);
  const currentLayout = videoLayouts[effectiveLayoutKey] || { bottomAlign: false, verticalOffset: 100 };

  const currentBinding = danmakuBindings[itemId];
  const currentOffset = itemOffsets[itemId] ?? 0;
  const [newBlockedWord, setNewBlockedWord] = useState('');

  // Update default search keyword when item changes
  useEffect(() => {
    if (defaultKeyword && !searchKeyword) {
      setSearchKeyword(defaultKeyword);
    }
  }, [defaultKeyword]);

  if (!isOpen) return null;

  // Manual search anime
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchKeyword.trim()) return;
    try {
      setSearching(true);
      const res = await searchDanmuAnime(activeServer, searchKeyword.trim());
      setSearchResults(res.animes || []);
      setSelectedAnime(null);
    } catch (err: any) {
      alert(`搜索失败: ${err.message || '请检查弹幕 API 节点是否连通'}`);
    } finally {
      setSearching(false);
    }
  };

  // Select Anime to fetch episodes
  const handleSelectAnime = async (anime: DanmuAnimeSearchResult) => {
    try {
      setLoadingEpisodes(true);
      setSelectedAnime(anime);
      const res = await getDanmuBangumiEpisodes(activeServer, anime.animeId);
      if (res?.bangumi?.episodes) {
        setSelectedAnime({ ...anime, episodes: res.bangumi.episodes });
      }
    } catch (err: any) {
      alert(`获取分集失败: ${err.message}`);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  // Load comments from specific episode & bind to current itemId
  const handleSelectEpisodeAndBind = async (ep: { episodeId: number | string; episodeTitle: string }) => {
    if (!selectedAnime) return;
    try {
      setLoadingEpisodes(true);
      const res = await fetchCommentsById(activeServer, ep.episodeId);

      // Persist binding
      bindDanmaku(itemId, {
        itemId,
        animeTitle: selectedAnime.animeTitle,
        episodeId: ep.episodeId,
        episodeTitle: ep.episodeTitle,
        sourcePlatform: selectedAnime.type || 'bangumi',
        commentCount: res.comments?.length || 0,
        sourceDuration: res.videoDuration,
      });

      onCommentsLoaded(res.comments, res.videoDuration, {
        animeTitle: selectedAnime.animeTitle,
        episodeTitle: ep.episodeTitle,
        episodeId: ep.episodeId,
      });

      setBindSuccessToast(`已成功绑定《${selectedAnime.animeTitle}》${ep.episodeTitle}`);
      setTimeout(() => setBindSuccessToast(null), 3500);
    } catch (err: any) {
      alert(`加载弹幕失败: ${err.message}`);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  // Unbind current episode
  const handleUnbind = () => {
    unbindDanmaku(itemId);
    setBindSuccessToast('已解除绑定，恢复自动匹配');
    setTimeout(() => setBindSuccessToast(null), 3000);
    if (onReAutoMatch) {
      onReAutoMatch();
    }
  };

  // Load comments via third-party web page URL
  const handleLoadByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directUrl.trim()) return;
    try {
      setLoadingUrl(true);
      const res = await fetchCommentsByVideoUrl(activeServer, directUrl.trim());
      onCommentsLoaded(res.comments, res.videoDuration, {
        animeTitle: '第三方直链',
        episodeTitle: directUrl.substring(0, 30) + '...',
        episodeId: directUrl,
      });
      setDirectUrl('');
      setBindSuccessToast('已成功提取网页弹幕');
      setTimeout(() => setBindSuccessToast(null), 3000);
    } catch (err: any) {
      alert(`解析网页弹幕失败: ${err.message}`);
    } finally {
      setLoadingUrl(false);
    }
  };

  // Offset change helper
  const adjustOffset = (deltaSeconds: number) => {
    const next = Math.round((currentOffset + deltaSeconds) * 10) / 10;
    bridge.offset = next;
    setItemOffset(itemId, next);
  };

  const resetOffset = () => {
    bridge.offset = 0;
    setItemOffset(itemId, 0);
  };

  // Blocked word add/remove
  const handleAddBlockedWord = (e: React.FormEvent) => {
    e.preventDefault();
    const word = newBlockedWord.trim();
    if (!word || danmakuSettings.blockedWords.includes(word)) return;
    updateDanmakuSettings({
      blockedWords: [...danmakuSettings.blockedWords, word],
    });
    setNewBlockedWord('');
  };

  const handleRemoveBlockedWord = (word: string) => {
    updateDanmakuSettings({
      blockedWords: danmakuSettings.blockedWords.filter((w) => w !== word),
    });
  };

  // Format seconds to mm:ss
  const formatSec = (sec?: number) => {
    if (!sec || isNaN(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const durationDiff =
    sourceDuration && videoDuration ? Math.round(Math.abs(sourceDuration - videoDuration)) : null;

  return (
    <>
      {/* 遮罩背景：点击抽屉外部空白区域可直接关闭抽屉 */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-50 w-[420px] bg-[#161922]/95 backdrop-blur-md border-l border-white/10 shadow-2xl flex flex-col text-gray-200 select-none animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold">弹幕控制中心</h2>
          </div>

          <div className="flex items-center space-x-2">
            {/* Danmu Server Indicator & Switcher */}
            <button
              onClick={() => setIsServerModalOpen(true)}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 hover:text-white transition border border-white/5 cursor-pointer"
              title="配置弹幕 API 节点"
            >
              <Server className="w-3.5 h-3.5 text-primary" />
              <span className="truncate max-w-[90px]">{activeServer.name}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition cursor-pointer"
              title="关闭弹幕设置 (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Bind Success Toast */}
        {bindSuccessToast && (
          <div className="mx-4 mt-3 p-2.5 bg-green-500/15 border border-green-500/30 rounded-xl text-xs text-green-300 flex items-center space-x-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-400" />
            <span className="truncate">{bindSuccessToast}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-white/10 text-sm">
          <button
            onClick={() => setActiveTab('match')}
            className={`flex-1 py-3 text-center font-medium border-b-2 transition ${
              activeTab === 'match'
                ? 'border-primary text-primary bg-white/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <div className="flex items-center justify-center space-x-1.5">
              <Tv className="w-4 h-4" />
              <span>源匹配 & 绑定</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('style')}
            className={`flex-1 py-3 text-center font-medium border-b-2 transition ${
              activeTab === 'style'
                ? 'border-primary text-primary bg-white/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <div className="flex items-center justify-center space-x-1.5">
              <Palette className="w-4 h-4" />
              <span>参数 & 画面</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('time')}
            className={`flex-1 py-3 text-center font-medium border-b-2 transition ${
              activeTab === 'time'
                ? 'border-primary text-primary bg-white/5'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <div className="flex items-center justify-center space-x-1.5">
              <Clock className="w-4 h-4" />
              <span>时间校准</span>
            </div>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {activeTab === 'match' && (
            <div className="space-y-6">
              {/* Current Bound / Matched Source Card */}
              <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    当前弹幕来源
                  </span>
                  {currentBinding ? (
                    <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[11px] font-semibold flex items-center space-x-1">
                      <BookmarkCheck className="w-3 h-3" />
                      <span>已手动绑定</span>
                    </span>
                  ) : currentMatchedTitle ? (
                    <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[11px] font-semibold flex items-center space-x-1">
                      <Sparkles className="w-3 h-3" />
                      <span>自动智能匹配</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[11px] font-semibold">
                      未匹配到弹幕
                    </span>
                  )}
                </div>

                {currentBinding ? (
                  <div className="space-y-2 pt-1">
                    <div className="text-sm font-bold text-white leading-snug">
                      《{currentBinding.animeTitle}》
                    </div>
                    <div className="text-xs text-primary font-medium">
                      {currentBinding.episodeTitle}
                    </div>
                    <div className="flex items-center space-x-3 text-xs text-gray-400 pt-1 border-t border-white/5">
                      <span>弹幕量: {currentBinding.commentCount} 条</span>
                      <span>平台: {currentBinding.sourcePlatform || 'Danmu API'}</span>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">
                        下次播放将自动沿用此绑定
                      </span>
                      <button
                        onClick={handleUnbind}
                        className="px-2.5 py-1 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-lg text-xs font-medium transition flex items-center space-x-1"
                      >
                        <Unlink className="w-3 h-3" />
                        <span>解除绑定</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 pt-1">
                    <div className="text-sm font-semibold text-white truncate">
                      {currentMatchedTitle || '暂无匹配弹幕'}
                    </div>
                    {sourceCommentCount > 0 && (
                      <div className="text-xs text-gray-400">已载入 {sourceCommentCount} 条弹幕</div>
                    )}
                    <p className="text-[11px] text-gray-500">
                      若自动匹配不准确，请在下方搜索栏输入正确的番剧/影视名进行手动搜索并绑定。
                    </p>
                  </div>
                )}

                {/* Duration comparison tip */}
                {sourceDuration && videoDuration && (
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                    <span>
                      弹幕时长: {formatSec(sourceDuration)} / 视频: {formatSec(videoDuration)}
                    </span>
                    {durationDiff && durationDiff > 10 && (
                      <span className="text-yellow-400 flex items-center space-x-1 text-[11px]">
                        <AlertTriangle className="w-3 h-3" />
                        <span>相差 {durationDiff} 秒</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Manual Search & Bind */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    手动搜索换源并绑定
                  </span>
                  <span className="text-[11px] text-gray-500">来自节点: {activeServer.name}</span>
                </div>

                <form onSubmit={handleSearch} className="flex space-x-2">
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="输入番剧或影视剧集名称..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-primary text-white placeholder-gray-500"
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl text-sm font-medium transition flex items-center space-x-1.5 disabled:opacity-50"
                  >
                    <Search className="w-4 h-4" />
                    <span>{searching ? '搜索中' : '搜索'}</span>
                  </button>
                </form>

                {/* Search Results list */}
                {searchResults.length > 0 && !selectedAnime && (
                  <div className="max-h-60 overflow-y-auto space-y-1.5 rounded-xl bg-black/30 p-2.5 border border-white/10">
                    <span className="text-[11px] text-gray-400 px-2 block mb-1">
                      搜索到 {searchResults.length} 个结果，点击选择番剧：
                    </span>
                    {searchResults.map((item) => (
                      <button
                        key={item.animeId}
                        onClick={() => handleSelectAnime(item)}
                        className="w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-white/10 transition flex items-center justify-between group"
                      >
                        <span className="truncate text-gray-200 group-hover:text-white font-medium">
                          {item.animeTitle}
                        </span>
                        <span className="text-xs text-primary/80 bg-primary/10 px-2 py-0.5 rounded-md flex-shrink-0 ml-2">
                          {item.type || '番剧'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Episode selector for chosen anime */}
                {selectedAnime && (
                  <div className="space-y-3 p-3.5 bg-black/40 rounded-xl border border-primary/30">
                    <div className="flex items-center justify-between pb-2 border-b border-white/10">
                      <div>
                        <span className="text-xs text-gray-400 block">选择并绑定分集:</span>
                        <span className="text-sm font-semibold text-primary">
                          《{selectedAnime.animeTitle}》
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedAnime(null)}
                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-xs text-gray-400 hover:text-white"
                      >
                        重新选番
                      </button>
                    </div>

                    {loadingEpisodes ? (
                      <div className="py-6 flex flex-col items-center justify-center space-y-2 text-gray-400">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-xs">正在获取分集列表...</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <span className="text-[11px] text-gray-400">
                          点击分集将立即拉取弹幕并永久绑定到本片：
                        </span>
                        <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pt-1 pr-1">
                          {selectedAnime.episodes?.map((ep) => (
                            <button
                              key={ep.episodeId}
                              onClick={() => handleSelectEpisodeAndBind(ep)}
                              className="px-2.5 py-2 bg-white/5 hover:bg-primary hover:text-white text-gray-200 text-xs rounded-lg transition text-left truncate border border-white/5"
                              title={ep.episodeTitle}
                            >
                              {ep.episodeTitle}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Direct URL Paste */}
              <div className="space-y-3 pt-3 border-t border-white/10">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  粘贴视频网页直链提取
                </span>
                <form onSubmit={handleLoadByUrl} className="flex space-x-2">
                  <input
                    type="text"
                    value={directUrl}
                    onChange={(e) => setDirectUrl(e.target.value)}
                    placeholder="B站/腾讯/爱奇艺播放页网址..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-primary text-white"
                  />
                  <button
                    type="submit"
                    disabled={loadingUrl}
                    className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition flex items-center space-x-1 disabled:opacity-50"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    <span>{loadingUrl ? '...' : '提取'}</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'style' && (
            <div className="space-y-6">
              {/* 宽银幕画面沉浸贴底卡片 */}
              <div className="bg-black/35 rounded-2xl p-4 border border-white/10 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <ArrowDownToLine className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-white">宽银幕贴底 (顶部留黑)</span>
                  </div>
                  {/* Toggle Switch */}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentLayout.bottomAlign}
                      onChange={(e) =>
                        setVideoLayout(effectiveLayoutKey, { bottomAlign: e.target.checked })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>

                <div className="text-xs text-gray-400 leading-relaxed">
                  消除底部黑边并将视频贴紧屏幕底部，让出顶部纯黑空间专供弹幕滑行，避免遮挡剧情画面。
                </div>

                {/* 片源比例状态与提示 */}
                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-white/5">
                  <span className="text-gray-400">片源画幅检测:</span>
                  {videoAspectRatio ? (
                    <span
                      className={`px-2 py-0.5 rounded font-mono font-medium ${
                        isWidescreen
                          ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                          : 'bg-white/10 text-gray-300'
                      }`}
                    >
                      {videoAspectRatio.toFixed(2)}:1 {isWidescreen ? '· 宽银幕推荐' : '· 标准画幅'}
                    </span>
                  ) : (
                    <span className="text-gray-500 font-mono">检测中...</span>
                  )}
                </div>

                {/* 垂直位置调节与微调控件（开启贴底时可用） */}
                {currentLayout.bottomAlign && (
                  <div className="space-y-3 pt-2.5 border-t border-white/10 animate-in fade-in duration-150">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-300 font-medium">垂直对齐锚点</span>
                      <span className="font-mono text-primary font-bold">
                        {currentLayout.verticalOffset}%{' '}
                        <span className="text-gray-400 font-normal text-[11px]">
                          ({currentLayout.verticalOffset === 100
                            ? '完全贴底'
                            : currentLayout.verticalOffset === 50
                            ? '居中'
                            : '贴底微调'})
                        </span>
                      </span>
                    </div>

                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="1"
                      value={currentLayout.verticalOffset}
                      onChange={(e) =>
                        setVideoLayout(effectiveLayoutKey, {
                          verticalOffset: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                    />

                    {/* 快捷对齐预设按钮 */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() =>
                          setVideoLayout(effectiveLayoutKey, { verticalOffset: 100 })
                        }
                        className={`py-1.5 rounded-lg text-xs font-medium transition ${
                          currentLayout.verticalOffset === 100
                            ? 'bg-primary text-white'
                            : 'bg-white/5 hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        完全贴底 100%
                      </button>
                      <button
                        onClick={() =>
                          setVideoLayout(effectiveLayoutKey, { verticalOffset: 95 })
                        }
                        className={`py-1.5 rounded-lg text-xs font-medium transition ${
                          currentLayout.verticalOffset === 95
                            ? 'bg-primary text-white'
                            : 'bg-white/5 hover:bg-white/10 text-gray-300'
                        }`}
                        title="底部预留少量缓冲，适合带硬字幕片源"
                      >
                        微浮避让 95%
                      </button>
                      <button
                        onClick={() =>
                          setVideoLayout(effectiveLayoutKey, { verticalOffset: 50 })
                        }
                        className={`py-1.5 rounded-lg text-xs font-medium transition ${
                          currentLayout.verticalOffset === 50
                            ? 'bg-primary text-white'
                            : 'bg-white/5 hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        居中 50%
                      </button>
                    </div>

                    {/* 记忆隔离说明 */}
                    <div className="flex items-center space-x-1.5 text-[11px] text-gray-400 pt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                      <span className="truncate">
                        {seriesName
                          ? `已自动记忆为《${seriesName}》专属设置，同剧所有集数生效`
                          : `已保存为本视频的专属设置`}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Danmaku Lines Setting */}
              <div className="space-y-2.5">
                <div className="flex justify-between items-center text-xs text-gray-300">
                  <div className="flex items-center space-x-1.5 font-medium">
                    <Layers className="w-3.5 h-3.5 text-primary" />
                    <span>同屏最大行数</span>
                  </div>
                  <span className="font-mono text-primary font-bold">
                    {danmakuSettings.maxLines === 0 ? '不限行数' : `${danmakuSettings.maxLines} 行`}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 3, 5, 8, 12].map((lines) => (
                    <button
                      key={lines}
                      onClick={() => updateDanmakuSettings({ maxLines: lines })}
                      className={`py-1.5 rounded-lg text-xs font-medium transition ${
                        danmakuSettings.maxLines === lines
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {lines === 0 ? '不限' : `${lines}行`}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="1"
                  value={danmakuSettings.maxLines}
                  onChange={(e) =>
                    updateDanmakuSettings({ maxLines: parseInt(e.target.value, 10) })
                  }
                  className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                />
              </div>

              {/* Color Mode Setting */}
              <div className="space-y-2.5 pt-2 border-t border-white/10">
                <div className="flex justify-between items-center text-xs text-gray-300">
                  <div className="flex items-center space-x-1.5 font-medium">
                    <Palette className="w-3.5 h-3.5 text-primary" />
                    <span>色彩模式</span>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {danmakuSettings.colorMode === 'vibrant'
                      ? '高对比度原色'
                      : danmakuSettings.colorMode === 'monochrome'
                      ? '统一纯白单色'
                      : '屏蔽彩色弹幕'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { mode: 'vibrant' as DanmakuColorMode, label: '多彩原色' },
                    { mode: 'monochrome' as DanmakuColorMode, label: '纯白单色' },
                    { mode: 'blocked' as DanmakuColorMode, label: '屏蔽彩色' },
                  ].map((item) => (
                    <button
                      key={item.mode}
                      onClick={() =>
                        updateDanmakuSettings({
                          colorMode: item.mode,
                          blockColor: item.mode === 'blocked',
                        })
                      }
                      className={`py-2 rounded-xl text-xs font-medium transition ${
                        danmakuSettings.colorMode === item.mode
                          ? 'bg-primary text-white shadow-md'
                          : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Area Ratio */}
              <div className="space-y-2.5 pt-2 border-t border-white/10">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>显示区域比例</span>
                  <span className="font-mono text-primary font-bold">
                    {Math.round(danmakuSettings.area * 100)}%
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[0.25, 0.5, 0.75, 1.0].map((val) => (
                    <button
                      key={val}
                      onClick={() => updateDanmakuSettings({ area: val })}
                      className={`py-1.5 rounded-lg text-xs font-medium transition ${
                        danmakuSettings.area === val
                          ? 'bg-primary text-white'
                          : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {val === 0.25 ? '1/4屏' : val === 0.5 ? '半屏' : val === 0.75 ? '3/4屏' : '满屏'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opacity */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>不透明度</span>
                  <span className="font-mono text-primary font-bold">
                    {Math.round(danmakuSettings.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={danmakuSettings.opacity}
                  onChange={(e) => updateDanmakuSettings({ opacity: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                />
              </div>

              {/* Speed */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>移动速度</span>
                  <span className="font-mono text-primary font-bold">
                    {danmakuSettings.speed} px/s
                  </span>
                </div>
                <input
                  type="range"
                  min="80"
                  max="280"
                  step="10"
                  value={danmakuSettings.speed}
                  onChange={(e) => updateDanmakuSettings({ speed: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-white/20 rounded-lg cursor-pointer accent-primary"
                />
              </div>

              {/* Font Size */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>字体大小</span>
                  <span className="font-mono text-primary font-bold">
                    {danmakuSettings.fontSize} px
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[18, 24, 30, 36].map((size) => (
                    <button
                      key={size}
                      onClick={() => updateDanmakuSettings({ fontSize: size })}
                      className={`py-1.5 rounded-lg text-xs font-medium transition ${
                        danmakuSettings.fontSize === size
                          ? 'bg-primary text-white'
                          : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {size === 18 ? '小' : size === 24 ? '中' : size === 30 ? '大' : '特大'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subtitle Clearance (Bottom Margin) */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex justify-between text-xs text-gray-300">
                  <span>底部字幕避让距离</span>
                  <span className="font-mono text-primary font-bold">
                    {danmakuSettings.bottomMargin} px
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 32, 48, 72].map((bm) => (
                    <button
                      key={bm}
                      onClick={() => updateDanmakuSettings({ bottomMargin: bm })}
                      className={`py-1.5 rounded-lg text-xs font-medium transition ${
                        danmakuSettings.bottomMargin === bm
                          ? 'bg-primary text-white'
                          : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {bm === 0 ? '无避让' : `${bm}px`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Position Block Toggles */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  类型屏蔽
                </span>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <label className="flex items-center space-x-2 p-2 bg-black/30 rounded-lg cursor-pointer hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={danmakuSettings.blockScroll}
                      onChange={(e) => updateDanmakuSettings({ blockScroll: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>滚动</span>
                  </label>
                  <label className="flex items-center space-x-2 p-2 bg-black/30 rounded-lg cursor-pointer hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={danmakuSettings.blockTop}
                      onChange={(e) => updateDanmakuSettings({ blockTop: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>顶部</span>
                  </label>
                  <label className="flex items-center space-x-2 p-2 bg-black/30 rounded-lg cursor-pointer hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={danmakuSettings.blockBottom}
                      onChange={(e) => updateDanmakuSettings({ blockBottom: e.target.checked })}
                      className="accent-primary"
                    />
                    <span>底部</span>
                  </label>
                </div>
              </div>

              {/* Keyword Blocking */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  关键词屏蔽
                </span>
                <form onSubmit={handleAddBlockedWord} className="flex space-x-2">
                  <input
                    type="text"
                    value={newBlockedWord}
                    onChange={(e) => setNewBlockedWord(e.target.value)}
                    placeholder="输入屏蔽词或关键词..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary text-white"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>添加</span>
                  </button>
                </form>

                {danmakuSettings.blockedWords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
                    {danmakuSettings.blockedWords.map((word) => (
                      <span
                        key={word}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 bg-white/10 rounded-full text-xs"
                      >
                        <span>{word}</span>
                        <button
                          onClick={() => handleRemoveBlockedWord(word)}
                          className="text-gray-400 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Playback Engine Selection */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex justify-between items-center text-xs text-gray-300">
                  <span>播放器内核 (切换即生效)</span>
                  <span className="font-mono text-primary font-bold text-[11px]">
                    {engineType === 'mpv' ? 'libmpv 原生硬解' : 'WebView 兼容'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setEngineType('mpv')}
                    className={`py-1.5 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
                      engineType === 'mpv'
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-white/5 hover:bg-white/10 text-gray-300'
                    }`}
                  >
                    <span>libmpv 原生硬解</span>
                  </button>
                  <button
                    onClick={() => setEngineType('html5')}
                    className={`py-1.5 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
                      engineType === 'html5'
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-white/5 hover:bg-white/10 text-gray-300'
                    }`}
                  >
                    <span>WebView 兼容</span>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  原生硬解支持 MKV 原盘直接播放与 DTS/TrueHD 音轨本地直解，Emby 服务端 0% 转码与重封装。
                </p>

                <div className="pt-2">
                  <button
                    onClick={() => setIsProxyModalOpen(true)}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5 text-primary" />
                    <span>网络与代理设置 (系统代理 / 手动代理)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'time' && (
            <div className="space-y-6">
              <div className="bg-black/40 rounded-xl p-4 border border-white/5 text-center">
                <span className="text-xs text-gray-400 block mb-1">当前弹幕时间偏移</span>
                <div className="text-3xl font-mono font-bold text-primary">
                  {currentOffset > 0 ? `+${currentOffset}` : currentOffset} 秒
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  正值代表弹幕提前出现，负值代表延后出现。设置会自动记住。
                </p>
              </div>

              <div className="space-y-3">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  快捷微调
                </span>
                <div className="grid grid-cols-5 gap-2">
                  <button
                    onClick={() => adjustOffset(-5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-lg text-xs font-mono font-bold transition"
                  >
                    -5s
                  </button>
                  <button
                    onClick={() => adjustOffset(-0.5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-lg text-xs font-mono font-bold transition"
                  >
                    -0.5s
                  </button>
                  <button
                    onClick={resetOffset}
                    className="py-2.5 bg-primary/20 hover:bg-primary text-primary hover:text-white rounded-lg text-xs font-bold transition"
                  >
                    重置
                  </button>
                  <button
                    onClick={() => adjustOffset(0.5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-lg text-xs font-mono font-bold transition"
                  >
                    +0.5s
                  </button>
                  <button
                    onClick={() => adjustOffset(5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-lg text-xs font-mono font-bold transition"
                  >
                    +5s
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Danmu Server Config Modal */}
      <DanmuServerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
      />

      {/* Network Proxy Config Modal */}
      <NetworkProxyModal
        isOpen={isProxyModalOpen}
        onClose={() => setIsProxyModalOpen(false)}
      />
    </>
  );
};

export default DanmakuDrawer;
