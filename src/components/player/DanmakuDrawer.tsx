import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  ListFilter,
  ShieldBan,
  Flame,
  LayoutGrid,
  List,
  LocateFixed,
} from 'lucide-react';
import {
  DanmuAnimeSearchResult,
  DanmuEpisode,
  searchDanmuAnime,
  getDanmuBangumiEpisodes,
  fetchCommentsById,
  fetchCommentsByVideoUrl,
  parseDanmuEpisodeInfo,
  RawDanmuComment,
} from '../../api/danmuClient';
import { MpvDanmakuBridge } from './MpvDanmakuBridge';
import { usePlayerStore, DanmakuColorMode } from '../../stores/usePlayerStore';
import { DanmuServerEntry, useDanmuStore } from '../../stores/useDanmuStore';
import { DanmuServerModal } from '../danmu/DanmuServerModal';

interface DanmuSearchResultWithServer extends DanmuAnimeSearchResult {
  _server: DanmuServerEntry;
}

interface DanmuNodeSearchStat {
  serverId: string;
  serverName: string;
  status: 'searching' | 'ok' | 'error';
  count: number;
  error?: string;
}

interface DanmakuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bridge: MpvDanmakuBridge;
  itemId: string;
  seriesId?: string;
  itemTitle?: string;
  seriesName?: string;
  episodeNumber?: number;
  currentMatchedTitle?: string;
  sourceCommentCount?: number;
  sourceDuration?: number;
  videoDuration?: number;
  rawComments?: RawDanmuComment[];
  currentTime?: number;
  onSeekToTime?: (seconds: number) => void;
  onCommentsLoaded: (
    comments: RawDanmuComment[],
    sourceDuration?: number,
    meta?: { animeTitle: string; episodeTitle: string; episodeId: number | string }
  ) => void;
  onReAutoMatch?: () => void;
}

const EPISODES_PER_PAGE = 50;

function formatSec(sec?: number): string {
  if (sec === undefined || Number.isNaN(sec)) return '--:--';
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const DanmakuDrawer = React.memo<DanmakuDrawerProps>(({
  isOpen,
  onClose,
  bridge,
  itemId,
  seriesId,
  itemTitle = '',
  seriesName = '',
  episodeNumber,
  currentMatchedTitle,
  sourceCommentCount = 0,
  sourceDuration,
  videoDuration,
  rawComments = [],
  currentTime = 0,
  onSeekToTime,
  onCommentsLoaded,
  onReAutoMatch,
}) => {
  const [activeTab, setActiveTab] = useState<'match' | 'time' | 'style' | 'list'>('match');
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);

  // Danmu servers store
  const { servers: danmuServers, getActiveServer } = useDanmuStore();
  const activeServer = getActiveServer();

  // Search state
  const defaultKeyword = seriesName || itemTitle.replace(/S\d+E\d+/i, '').trim();
  const [searchKeyword, setSearchKeyword] = useState(defaultKeyword);
  const [searching, setSearching] = useState(false);
  const [searchAllNodes, setSearchAllNodes] = useState(true);
  const [searchResults, setSearchResults] = useState<DanmuSearchResultWithServer[]>([]);
  const [nodeSearchStats, setNodeSearchStats] = useState<DanmuNodeSearchStat[]>([]);
  const [filterNodeId, setFilterNodeId] = useState<string>('ALL');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedAnime, setSelectedAnime] = useState<DanmuSearchResultWithServer | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [bindingEpisodeId, setBindingEpisodeId] = useState<string | number | null>(null);
  const [episodeFilter, setEpisodeFilter] = useState('');
  const [episodeRangePage, setEpisodeRangePage] = useState(0);
  const [episodeViewModeOverride, setEpisodeViewModeOverride] = useState<'grid' | 'list' | null>(
    null
  );
  const [manualScrollTick, setManualScrollTick] = useState(0);
  const episodeBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const episodeListContainerRef = useRef<HTMLDivElement | null>(null);
  const rangeTabsContainerRef = useRef<HTMLDivElement | null>(null);
  const rangeTabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const autoScrolledKeyRef = useRef<string | null>(null);
  const searchReqIdRef = useRef(0);
  const animeLoadReqIdRef = useRef(0);
  const [directUrl, setDirectUrl] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [bindSuccessToast, setBindSuccessToast] = useState<string | null>(null);

  // List filter state
  const [listQuery, setListQuery] = useState('');
  const [nearCurrentOnly, setNearCurrentOnly] = useState(false);

  // Store
  const danmakuSettings = usePlayerStore((s) => s.danmakuSettings);
  const updateDanmakuSettings = usePlayerStore((s) => s.updateDanmakuSettings);
  const setItemOffset = usePlayerStore((s) => s.setItemOffset);
  const setSeriesOffset = usePlayerStore((s) => s.setSeriesOffset);
  const itemOffsets = usePlayerStore((s) => s.itemOffsets);
  const seriesOffsets = usePlayerStore((s) => s.seriesOffsets);
  const danmakuBindings = usePlayerStore((s) => s.danmakuBindings);
  const seriesDanmakuBindings = usePlayerStore((s) => s.seriesDanmakuBindings);
  const bindDanmaku = usePlayerStore((s) => s.bindDanmaku);
  const unbindDanmaku = usePlayerStore((s) => s.unbindDanmaku);
  const bindSeriesDanmaku = usePlayerStore((s) => s.bindSeriesDanmaku);

  const currentBinding = danmakuBindings[itemId];
  const currentSeriesBinding = seriesId ? seriesDanmakuBindings[seriesId] : undefined;
  const currentOffset =
    itemOffsets[itemId] ?? (seriesId ? seriesOffsets[seriesId] : undefined) ?? 0;
  const [newBlockedWord, setNewBlockedWord] = useState('');

  // Update default search keyword when item changes
  useEffect(() => {
    if (defaultKeyword) {
      setSearchKeyword(defaultKeyword);
    }
  }, [defaultKeyword]);

  // 关闭抽屉时重置自动滚动锁，确保下次重新打开仍可平滑滚回匹配集
  useEffect(() => {
    if (!isOpen) {
      autoScrolledKeyRef.current = null;
    }
  }, [isOpen]);

  // 当前播放集号推导：优先使用 Emby IndexNumber，缺失时从标题提取兜底
  const effectiveEpisodeNumber = useMemo(() => {
    if (typeof episodeNumber === 'number' && Number.isFinite(episodeNumber) && episodeNumber > 0) {
      return episodeNumber;
    }
    const rawTitle = (itemTitle || '').trim();
    if (!rawTitle) return undefined;
    const patterns = [
      /S\d+E0*(\d+)/i,
      /第\s*0*(\d+)\s*(?:集|话|話|期|回)/,
      /(?:^|[\s._-])(?:EP|E)0*(\d+)(?![a-zA-Z0-9])/i,
    ];
    for (const re of patterns) {
      const match = rawTitle.match(re);
      if (match) {
        const num = Number(match[1]);
        if (Number.isFinite(num) && num > 0 && num < 10000) {
          return num;
        }
      }
    }
    return undefined;
  }, [episodeNumber, itemTitle]);

  // 结构化解析当前所选番剧分集：去前缀、提集号、判断默认视图与当前集定位
  const parsedEpisodes = useMemo(() => {
    const list = selectedAnime?.episodes || [];
    return list.map((ep: DanmuEpisode, index: number) => ({
      ep,
      index,
      parsed: parseDanmuEpisodeInfo(ep, index),
    }));
  }, [selectedAnime?.episodes]);

  const dominantPlatform = useMemo(() => {
    if (parsedEpisodes.length === 0) return null;
    const counts = new Map<string, number>();
    for (const entry of parsedEpisodes) {
      if (entry.parsed.platform) {
        counts.set(entry.parsed.platform, (counts.get(entry.parsed.platform) || 0) + 1);
      }
    }
    if (counts.size === 0) return null;
    let topPlatform = '';
    let topCount = 0;
    for (const [p, count] of counts.entries()) {
      if (count > topCount) {
        topPlatform = p;
        topCount = count;
      }
    }
    return topCount >= Math.ceil(parsedEpisodes.length * 0.5) ? topPlatform : null;
  }, [parsedEpisodes]);

  const hasSubtitles = useMemo(
    () => parsedEpisodes.some((entry) => entry.parsed.subTitle.length > 0),
    [parsedEpisodes]
  );

  const episodeViewMode: 'grid' | 'list' =
    episodeViewModeOverride ?? (hasSubtitles ? 'list' : 'grid');

  // 优先按当前播放集号匹配（兼容选新番或纠错换源场景），未命中再回退已绑定 episodeId
  const currentMatchedEpIndex = useMemo(() => {
    if (parsedEpisodes.length === 0) return -1;
    if (effectiveEpisodeNumber !== undefined && effectiveEpisodeNumber > 0) {
      const numIdx = parsedEpisodes.findIndex(
        (entry) => entry.parsed.episodeNumber === effectiveEpisodeNumber
      );
      if (numIdx >= 0) return numIdx;
      if (parsedEpisodes[effectiveEpisodeNumber - 1]) return effectiveEpisodeNumber - 1;
    }
    if (currentBinding?.episodeId !== undefined) {
      const boundIdx = parsedEpisodes.findIndex(
        (entry) => String(entry.ep.episodeId) === String(currentBinding.episodeId)
      );
      if (boundIdx >= 0) return boundIdx;
    }
    return -1;
  }, [parsedEpisodes, effectiveEpisodeNumber, currentBinding?.episodeId]);

  useEffect(() => {
    setEpisodeFilter('');
    setEpisodeViewModeOverride(null);
    autoScrolledKeyRef.current = null;
    episodeBtnRefs.current = {};
  }, [selectedAnime?.animeId]);

  useEffect(() => {
    if (parsedEpisodes.length === 0) {
      setEpisodeRangePage(0);
      return;
    }
    if (currentMatchedEpIndex >= 0) {
      setEpisodeRangePage(Math.floor(currentMatchedEpIndex / EPISODES_PER_PAGE));
    } else {
      setEpisodeRangePage(0);
    }
  }, [selectedAnime?.animeId, parsedEpisodes.length, currentMatchedEpIndex]);

  const totalEpisodes = parsedEpisodes.length;
  const totalEpisodePages = Math.ceil(totalEpisodes / EPISODES_PER_PAGE);
  const safeEpisodeRangePage = Math.min(
    episodeRangePage,
    Math.max(0, totalEpisodePages - 1)
  );
  const trimmedEpisodeFilter = episodeFilter.trim().toLowerCase();

  const filteredEpisodes = useMemo(() => {
    if (trimmedEpisodeFilter) {
      return parsedEpisodes.filter(({ ep, index, parsed }) => {
        const seq = String(index + 1);
        return (
          parsed.shortLabel.toLowerCase().includes(trimmedEpisodeFilter) ||
          parsed.badgeLabel.toLowerCase().includes(trimmedEpisodeFilter) ||
          parsed.subTitle.toLowerCase().includes(trimmedEpisodeFilter) ||
          ep.episodeTitle.toLowerCase().includes(trimmedEpisodeFilter) ||
          seq.includes(trimmedEpisodeFilter)
        );
      });
    }
    if (totalEpisodes > EPISODES_PER_PAGE) {
      const start = safeEpisodeRangePage * EPISODES_PER_PAGE;
      return parsedEpisodes.slice(start, start + EPISODES_PER_PAGE);
    }
    return parsedEpisodes;
  }, [parsedEpisodes, trimmedEpisodeFilter, totalEpisodes, safeEpisodeRangePage]);

  // 选中弹幕源加载分集完毕后，自动将容器与分页条平滑滚动居中到匹配集数
  useEffect(() => {
    if (
      !isOpen ||
      activeTab !== 'match' ||
      !selectedAnime ||
      loadingEpisodes ||
      totalEpisodes === 0 ||
      currentMatchedEpIndex < 0 ||
      trimmedEpisodeFilter
    ) {
      return;
    }

    const targetPage = Math.floor(currentMatchedEpIndex / EPISODES_PER_PAGE);
    if (safeEpisodeRangePage !== targetPage) {
      return;
    }

    const targetEntry = parsedEpisodes[currentMatchedEpIndex];
    if (!targetEntry) return;

    const scrollKey = `${selectedAnime.animeId}:${totalEpisodes}:${currentMatchedEpIndex}:${manualScrollTick}`;
    if (autoScrolledKeyRef.current === scrollKey) {
      return;
    }
    autoScrolledKeyRef.current = scrollKey;

    const targetEpisodeKey = String(targetEntry.ep.episodeId);
    let raf1 = 0;
    let raf2 = 0;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const container = episodeListContainerRef.current;
        const targetEl = episodeBtnRefs.current[targetEpisodeKey];
        if (container && targetEl) {
          const containerRect = container.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const offsetWithinContainer = targetRect.top - containerRect.top;
          const targetTop =
            container.scrollTop +
            offsetWithinContainer -
            container.clientHeight / 2 +
            targetRect.height / 2;
          container.scrollTo({
            top: Math.max(0, targetTop),
            behavior: 'smooth',
          });
        }

        const rangeContainer = rangeTabsContainerRef.current;
        const rangeTabEl = rangeTabRefs.current[targetPage];
        if (rangeContainer && rangeTabEl) {
          const rangeRect = rangeContainer.getBoundingClientRect();
          const tabRect = rangeTabEl.getBoundingClientRect();
          const offsetLeft = tabRect.left - rangeRect.left;
          const targetLeft =
            rangeContainer.scrollLeft +
            offsetLeft -
            rangeContainer.clientWidth / 2 +
            tabRect.width / 2;
          rangeContainer.scrollTo({
            left: Math.max(0, targetLeft),
            behavior: 'smooth',
          });
        }
      });
    });

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [
    isOpen,
    activeTab,
    selectedAnime?.animeId,
    loadingEpisodes,
    totalEpisodes,
    currentMatchedEpIndex,
    safeEpisodeRangePage,
    trimmedEpisodeFilter,
    manualScrollTick,
    parsedEpisodes,
  ]);

  // 弹幕列表索引与检索（将 currentTime 量化为 5 秒分桶，避免播放时每秒多次触发全量重排）
  const nearTimeBucket = nearCurrentOnly ? Math.floor(currentTime / 5) * 5 : 0;
  const parsedDanmuList = useMemo(() => {
    if (!isOpen || activeTab !== 'list' || rawComments.length === 0) return [];
    const q = listQuery.trim().toLowerCase();
    const list: { cid: number; time: number; text: string }[] = [];

    for (let i = 0; i < rawComments.length; i++) {
      const c = rawComments[i];
      if (!c.m || !c.p) continue;
      const t = parseFloat(c.p.split(',')[0]) || 0;
      if (nearCurrentOnly && Math.abs(t - nearTimeBucket) > 120) continue;
      if (q && !c.m.toLowerCase().includes(q)) continue;
      list.push({ cid: c.cid || i, time: t, text: c.m });
    }

    list.sort((a, b) => a.time - b.time);
    return list.slice(0, 200);
  }, [isOpen, activeTab, rawComments, listQuery, nearCurrentOnly, nearTimeBucket]);

  const filteredSearchResults = useMemo(() => {
    if (filterNodeId === 'ALL') return searchResults;
    return searchResults.filter((item) => item._server.id === filterNodeId);
  }, [searchResults, filterNodeId]);

  useEffect(() => {
    return () => {
      searchReqIdRef.current += 1;
    };
  }, []);

  if (!isOpen) return null;

  const handleLocateCurrentEpisode = () => {
    if (currentMatchedEpIndex < 0) return;
    setEpisodeFilter('');
    setEpisodeRangePage(Math.floor(currentMatchedEpIndex / EPISODES_PER_PAGE));
    setManualScrollTick((n) => n + 1);
  };

  const showToast = (msg: string) => {
    setBindSuccessToast(msg);
    setTimeout(() => setBindSuccessToast(null), 3500);
  };

  // Manual multi-node concurrent search anime
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const keyword = searchKeyword.trim();
    if (!keyword) return;

    const reqId = ++searchReqIdRef.current;
    animeLoadReqIdRef.current += 1;

    const targetServers =
      searchAllNodes && danmuServers.length > 1 ? danmuServers : [activeServer];

    setSearching(true);
    setSearchResults([]);
    setSelectedAnime(null);
    setLoadingEpisodes(false);
    setFilterNodeId('ALL');
    setSearchError(null);
    setNodeSearchStats(
      targetServers.map((srv) => ({
        serverId: srv.id,
        serverName: srv.name,
        status: 'searching',
        count: 0,
      }))
    );

    const tasks = targetServers.map(async (srv) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const res = await Promise.race([
          searchDanmuAnime(srv, keyword),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('请求超时')), 10000);
          }),
        ]);
        if (reqId !== searchReqIdRef.current) return { ok: true, count: 0 };

        const tagged: DanmuSearchResultWithServer[] = (res?.animes || []).map((anime) => ({
          ...anime,
          _server: srv,
        }));

        setNodeSearchStats((prev) =>
          prev.map((st) =>
            st.serverId === srv.id ? { ...st, status: 'ok', count: tagged.length } : st
          )
        );

        if (tagged.length > 0) {
          setSearchResults((prev) => {
            const seen = new Set(prev.map((p) => `${p._server.id}::${p.animeId}`));
            const next = [...prev];
            for (const entry of tagged) {
              const key = `${entry._server.id}::${entry.animeId}`;
              if (!seen.has(key)) {
                seen.add(key);
                next.push(entry);
              }
            }
            return next;
          });
        }

        return { ok: true, count: tagged.length };
      } catch (err: any) {
        if (reqId !== searchReqIdRef.current) return { ok: false, count: 0 };
        const errMsg = err?.message || '连接失败';
        setNodeSearchStats((prev) =>
          prev.map((st) =>
            st.serverId === srv.id ? { ...st, status: 'error', count: 0, error: errMsg } : st
          )
        );
        return { ok: false, count: 0, error: errMsg };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    });

    const settled = await Promise.allSettled(tasks);
    if (reqId !== searchReqIdRef.current) return;

    const anySucceeded = settled.some((s) => s.status === 'fulfilled' && s.value.ok);
    if (!anySucceeded) {
      const firstErr = settled.find(
        (s): s is PromiseFulfilledResult<{ ok: false; count: number; error?: string }> =>
          s.status === 'fulfilled' && !s.value.ok && Boolean(s.value.error)
      )?.value.error;
      setSearchError(
        `搜索失败${firstErr ? `（${firstErr}）` : ''}，请检查弹幕 API 节点是否连通`
      );
    }

    setSearching(false);
  };

  // Select Anime to fetch episodes from its originating node
  const handleSelectAnime = async (anime: DanmuSearchResultWithServer) => {
    const reqId = ++animeLoadReqIdRef.current;
    try {
      setLoadingEpisodes(true);
      setSelectedAnime(anime);
      const res = await getDanmuBangumiEpisodes(anime._server, anime.animeId);
      if (reqId !== animeLoadReqIdRef.current) return;
      if (res?.bangumi?.episodes) {
        setSelectedAnime({ ...anime, episodes: res.bangumi.episodes });
      }
    } catch (err: any) {
      if (reqId !== animeLoadReqIdRef.current) return;
      alert(`获取分集失败: ${err.message}`);
    } finally {
      if (reqId === animeLoadReqIdRef.current) {
        setLoadingEpisodes(false);
      }
    }
  };

  // Load comments from specific episode & bind to current itemId + seriesId
  const handleSelectEpisodeAndBind = async (ep: {
    episodeId: number | string;
    episodeTitle: string;
  }) => {
    if (!selectedAnime || bindingEpisodeId !== null) return;
    try {
      setBindingEpisodeId(ep.episodeId);
      const targetServer = selectedAnime._server;
      const res = await fetchCommentsById(targetServer, ep.episodeId);

      // Persist item binding with originating danmu node metadata
      bindDanmaku(itemId, {
        itemId,
        seriesId,
        animeTitle: selectedAnime.animeTitle,
        episodeId: ep.episodeId,
        episodeTitle: ep.episodeTitle,
        sourcePlatform: selectedAnime.type || 'bangumi',
        commentCount: res.comments?.length || 0,
        sourceDuration: res.videoDuration,
        danmuServerId: targetServer.id,
        danmuServerBaseUrl: targetServer.baseUrl,
      });

      // Persist series continuation binding so next episodes auto-match seamlessly from the same node
      if (seriesId && selectedAnime.episodes && selectedAnime.episodes.length > 0) {
        bindSeriesDanmaku(seriesId, {
          seriesId,
          animeId: selectedAnime.animeId,
          animeTitle: selectedAnime.animeTitle,
          episodes: selectedAnime.episodes,
          danmuServerId: targetServer.id,
          danmuServerBaseUrl: targetServer.baseUrl,
        });
      }

      onCommentsLoaded(res.comments, res.videoDuration, {
        animeTitle: selectedAnime.animeTitle,
        episodeTitle: ep.episodeTitle,
        episodeId: ep.episodeId,
      });

      showToast(
        seriesId
          ? `已绑定《${selectedAnime.animeTitle}》${ep.episodeTitle}（同剧后续分集将自动延续）`
          : `已成功绑定《${selectedAnime.animeTitle}》${ep.episodeTitle}`
      );
    } catch (err: any) {
      alert(`加载弹幕失败: ${err.message}`);
    } finally {
      setBindingEpisodeId(null);
    }
  };

  // Unbind current episode
  const handleUnbind = () => {
    unbindDanmaku(itemId);
    showToast('已解除绑定，恢复自动匹配');
    onReAutoMatch?.();
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
      showToast('已成功提取网页弹幕');
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

  const applyOffsetToWholeSeries = () => {
    if (!seriesId) return;
    setSeriesOffset(seriesId, currentOffset);
    showToast(`已将 ${currentOffset >= 0 ? `+${currentOffset}` : currentOffset}s 偏移应用到整部剧集`);
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

  const handleQuickBlockText = (text: string) => {
    const snippet = text.trim();
    if (!snippet || danmakuSettings.blockedWords.includes(snippet)) return;
    updateDanmakuSettings({
      blockedWords: [...danmakuSettings.blockedWords, snippet],
    });
    showToast(`已屏蔽关键词: ${snippet}`);
  };

  const handleRemoveBlockedWord = (word: string) => {
    updateDanmakuSettings({
      blockedWords: danmakuSettings.blockedWords.filter((w) => w !== word),
    });
  };

  const durationDiff =
    sourceDuration && videoDuration ? Math.round(Math.abs(sourceDuration - videoDuration)) : null;
  const suggestedSignedOffset =
    sourceDuration && videoDuration ? Math.round(sourceDuration - videoDuration) : null;

  return (
    <>
      <div className="fixed inset-0 z-20 bg-transparent" onClick={onClose} />
      <div className="fixed top-16 bottom-24 right-6 z-30 w-80 sm:w-[400px] lg:w-[430px] rounded-2xl bg-[#0B0E17]/95 backdrop-blur-2xl border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.75)] flex flex-col text-gray-200 select-none animate-in slide-in-from-right duration-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold tracking-wide text-white">弹幕控制中心</h2>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsServerModalOpen(true)}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 hover:text-white transition border border-white/5 cursor-pointer"
              title="配置弹幕 API 节点"
            >
              <Server className="w-3.5 h-3.5 text-primary" />
              <span className="truncate max-w-[80px]">{activeServer.name}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition cursor-pointer"
              title="关闭弹幕设置 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toast */}
        {bindSuccessToast && (
          <div className="mx-4 mt-3 p-2.5 bg-green-500/15 border border-green-500/30 rounded-xl text-xs text-green-300 flex items-center space-x-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-400" />
            <span className="truncate">{bindSuccessToast}</span>
          </div>
        )}

        {/* 4-Tab Segmented Control */}
        <div className="p-3 border-b border-white/10 bg-white/[0.01]">
          <div className="grid grid-cols-4 bg-white/5 p-1 rounded-xl border border-white/5 text-xs font-medium gap-1">
            <button
              onClick={() => setActiveTab('match')}
              className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 cursor-pointer ${
                activeTab === 'match'
                  ? 'bg-primary text-white font-semibold shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>换源</span>
            </button>
            <button
              onClick={() => setActiveTab('time')}
              className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 cursor-pointer ${
                activeTab === 'time'
                  ? 'bg-primary text-white font-semibold shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>校准</span>
            </button>
            <button
              onClick={() => setActiveTab('style')}
              className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 cursor-pointer ${
                activeTab === 'style'
                  ? 'bg-primary text-white font-semibold shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>样式</span>
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={`py-1.5 rounded-lg transition flex items-center justify-center space-x-1 cursor-pointer ${
                activeTab === 'list'
                  ? 'bg-primary text-white font-semibold shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>列表</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
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
                      <span>{currentSeriesBinding ? '同剧延续匹配' : '自动智能匹配'}</span>
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
                        className="px-2.5 py-1 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer"
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
                      若自动匹配不准确，在下方搜番绑定任意一集后，同剧后续分集将自动沿用该番剧源。
                    </p>
                  </div>
                )}

                {sourceDuration && videoDuration && (
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                    <span>
                      弹幕时长: {formatSec(sourceDuration)} / 视频: {formatSec(videoDuration)}
                    </span>
                    {durationDiff && durationDiff > 10 && (
                      <span className="text-yellow-400 flex items-center space-x-1 text-[11px]">
                        <AlertTriangle className="w-3 h-3" />
                        <span>相差 {durationDiff}s</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Manual Search & Bind */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    手动搜索换源并绑定
                  </span>
                  {danmuServers.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setSearchAllNodes((v) => !v)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition cursor-pointer flex items-center space-x-1 ${
                        searchAllNodes
                          ? 'bg-primary/15 border-primary/40 text-primary'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                      title="切换全部弹幕节点并发搜索 / 仅当前节点搜索"
                    >
                      <Server className="w-3 h-3" />
                      <span>
                        {searchAllNodes
                          ? `全部节点并发 (${danmuServers.length})`
                          : `仅当前: ${activeServer.name}`}
                      </span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-gray-500">节点: {activeServer.name}</span>
                  )}
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
                    className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-xl text-sm font-medium transition flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <Search className="w-4 h-4" />
                    <span>{searching ? '搜索中' : '搜索'}</span>
                  </button>
                </form>

                {nodeSearchStats.length > 1 && !selectedAnime && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFilterNodeId('ALL')}
                      className={`px-2 py-1 rounded-lg text-[11px] border transition cursor-pointer ${
                        filterNodeId === 'ALL'
                          ? 'bg-primary/20 border-primary/45 text-primary font-semibold'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      全部 ({searchResults.length})
                    </button>
                    {nodeSearchStats.map((st) => {
                      const isActiveFilter = filterNodeId === st.serverId;
                      return (
                        <button
                          key={st.serverId}
                          type="button"
                          onClick={() => setFilterNodeId(st.serverId)}
                          title={st.error || undefined}
                          className={`px-2 py-1 rounded-lg text-[11px] border transition cursor-pointer flex items-center space-x-1.5 ${
                            isActiveFilter
                              ? 'bg-primary/20 border-primary/45 text-primary font-semibold'
                              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              st.status === 'searching'
                                ? 'bg-sky-400 animate-pulse'
                                : st.status === 'ok'
                                ? 'bg-emerald-400'
                                : 'bg-amber-400'
                            }`}
                          />
                          <span className="truncate max-w-[96px]">{st.serverName}</span>
                          <span className="font-mono text-[10px] opacity-80">
                            ({st.status === 'searching' ? '...' : st.status === 'error' ? '离线' : st.count})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {searchError && !selectedAnime && (
                  <div className="text-xs px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300">
                    {searchError}
                  </div>
                )}

                {!searching &&
                  !searchError &&
                  nodeSearchStats.length > 0 &&
                  filteredSearchResults.length === 0 &&
                  !selectedAnime && (
                    <div className="text-xs text-center py-4 rounded-xl bg-black/25 border border-white/5 text-gray-500">
                      当前关键词下暂无匹配番剧结果
                    </div>
                  )}

                {filteredSearchResults.length > 0 && !selectedAnime && (
                  <div className="max-h-64 overflow-y-auto space-y-1.5 rounded-xl bg-black/30 p-2.5 border border-white/10 custom-scrollbar">
                    <span className="text-[11px] text-gray-400 px-2 block mb-1">
                      搜索到 {filteredSearchResults.length} 个结果，点击选择番剧：
                    </span>
                    {filteredSearchResults.map((item) => (
                      <button
                        key={`${item._server.id}::${item.animeId}`}
                        onClick={() => handleSelectAnime(item)}
                        className="w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-white/10 transition flex items-start justify-between gap-2 group cursor-pointer"
                        title={item.animeTitle}
                      >
                        <span className="text-gray-200 group-hover:text-white font-medium line-clamp-2 leading-snug">
                          {item.animeTitle}
                        </span>
                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                          {danmuServers.length > 1 && (
                            <span className="text-[10px] font-mono text-sky-300/90 bg-sky-500/15 border border-sky-400/25 px-1.5 py-0.5 rounded">
                              {item._server.name}
                            </span>
                          )}
                          <span className="text-[11px] text-primary/85 bg-primary/10 px-2 py-0.5 rounded-md">
                            {item.type || '番剧'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {selectedAnime && (
                  <div className="space-y-3 p-3.5 bg-black/40 rounded-xl border border-primary/30">
                    <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/10">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className="text-[11px] text-gray-400">
                            已选番剧{totalEpisodes > 0 ? ` · 共 ${totalEpisodes} 集` : ''}
                          </span>
                          {danmuServers.length > 1 && (
                            <span className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-[10px] font-mono text-gray-200">
                              节点: {selectedAnime._server.name}
                            </span>
                          )}
                          {dominantPlatform && (
                            <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/25 text-[10px] font-mono text-sky-300">
                              来源: {dominantPlatform}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-primary leading-snug">
                          《{selectedAnime.animeTitle}》
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          animeLoadReqIdRef.current += 1;
                          setLoadingEpisodes(false);
                          setSelectedAnime(null);
                        }}
                        className="shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 hover:text-white transition border border-white/10 cursor-pointer"
                      >
                        重新选番
                      </button>
                    </div>

                    {loadingEpisodes ? (
                      <div className="py-6 flex flex-col items-center justify-center space-y-2 text-gray-400">
                        <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-xs">正在获取分集列表...</span>
                      </div>
                    ) : totalEpisodes === 0 ? (
                      <div className="py-6 text-center text-xs text-gray-500">
                        该番剧源暂无可用分集列表
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <span className="text-[11px] text-gray-400 block leading-relaxed">
                          {currentMatchedEpIndex >= 0 ? (
                            <>
                              已自动匹配至{' '}
                              <span className="text-sky-300 font-semibold font-mono">
                                {parsedEpisodes[currentMatchedEpIndex]?.parsed.badgeLabel}
                              </span>
                              ，点击分集立即拉取并绑定（同剧集后续自动延续）：
                            </>
                          ) : (
                            '点击分集立即拉取弹幕并绑定（同剧集后续分集自动延续）：'
                          )}
                        </span>

                        {/* 筛选、定位当前集与视图切换工具栏 */}
                        <div className="flex items-center gap-1.5">
                          <div className="relative flex-1 min-w-0">
                            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              type="text"
                              value={episodeFilter}
                              onChange={(e) => setEpisodeFilter(e.target.value)}
                              placeholder="筛选集数/标题，如 188..."
                              className="w-full bg-black/50 border border-white/10 rounded-lg pl-7 pr-6 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-primary"
                            />
                            {episodeFilter && (
                              <button
                                type="button"
                                onClick={() => setEpisodeFilter('')}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5 cursor-pointer"
                                title="清空筛选"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {currentMatchedEpIndex >= 0 && (
                            <button
                              type="button"
                              onClick={handleLocateCurrentEpisode}
                              className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-400/25 text-[11px] font-medium transition cursor-pointer whitespace-nowrap"
                              title={`定位到当前播放集 (${parsedEpisodes[currentMatchedEpIndex]?.parsed.badgeLabel})`}
                            >
                              <LocateFixed className="w-3.5 h-3.5" />
                              <span>定位</span>
                            </button>
                          )}

                          <div className="shrink-0 flex items-center bg-black/50 p-0.5 rounded-lg border border-white/10">
                            <button
                              type="button"
                              onClick={() => setEpisodeViewModeOverride('grid')}
                              className={`p-1.5 rounded-md transition cursor-pointer ${
                                episodeViewMode === 'grid'
                                  ? 'bg-primary text-white'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                              title="集号网格视图"
                            >
                              <LayoutGrid className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEpisodeViewModeOverride('list')}
                              className={`p-1.5 rounded-md transition cursor-pointer ${
                                episodeViewMode === 'list'
                                  ? 'bg-primary text-white'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                              title="分集列表视图"
                            >
                              <List className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* 超过 50 集时展示分段范围标签 */}
                        {!trimmedEpisodeFilter && totalEpisodePages > 1 && (
                          <div
                            ref={rangeTabsContainerRef}
                            className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar"
                          >
                            {Array.from({ length: totalEpisodePages }, (_, pageIdx) => {
                              const startEp = pageIdx * EPISODES_PER_PAGE + 1;
                              const endEp = Math.min(
                                (pageIdx + 1) * EPISODES_PER_PAGE,
                                totalEpisodes
                              );
                              const isActivePage = pageIdx === safeEpisodeRangePage;
                              return (
                                <button
                                  key={pageIdx}
                                  ref={(el) => {
                                    rangeTabRefs.current[pageIdx] = el;
                                  }}
                                  type="button"
                                  onClick={() => setEpisodeRangePage(pageIdx)}
                                  className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-mono font-medium transition cursor-pointer border ${
                                    isActivePage
                                      ? 'bg-primary/20 border-primary text-primary font-semibold'
                                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                                  }`}
                                >
                                  {startEp}-{endEp}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {filteredEpisodes.length === 0 ? (
                          <div className="py-6 text-center text-xs text-gray-500">
                            未找到匹配「{episodeFilter.trim()}」的分集
                          </div>
                        ) : episodeViewMode === 'list' ? (
                          <div
                            ref={episodeListContainerRef}
                            className="space-y-1.5 max-h-72 overflow-y-auto pt-0.5 pr-1 custom-scrollbar"
                          >
                            {filteredEpisodes.map(({ ep, index, parsed }) => {
                              const isBound =
                                currentBinding?.episodeId !== undefined &&
                                String(currentBinding.episodeId) === String(ep.episodeId);
                              const isCurrentEp =
                                effectiveEpisodeNumber !== undefined &&
                                effectiveEpisodeNumber > 0 &&
                                (parsed.episodeNumber === effectiveEpisodeNumber ||
                                  (parsed.episodeNumber === undefined &&
                                    index === effectiveEpisodeNumber - 1));
                              const isBindingThis =
                                bindingEpisodeId !== null &&
                                String(bindingEpisodeId) === String(ep.episodeId);
                              const hoverTitle = [
                                parsed.badgeLabel,
                                parsed.subTitle,
                                ep.episodeTitle !== parsed.cleanTitle
                                  ? `原始: ${ep.episodeTitle}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ');

                              return (
                                <button
                                  key={ep.episodeId}
                                  ref={(el) => {
                                    episodeBtnRefs.current[String(ep.episodeId)] = el;
                                  }}
                                  disabled={bindingEpisodeId !== null}
                                  onClick={() => handleSelectEpisodeAndBind(ep)}
                                  title={hoverTitle}
                                  className={`w-full px-2.5 py-2 rounded-lg border transition flex items-center gap-2 text-left group cursor-pointer disabled:cursor-wait ${
                                    isBindingThis
                                      ? 'bg-primary/25 border-primary text-white'
                                      : isBound
                                      ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-100'
                                      : isCurrentEp
                                      ? 'bg-sky-500/15 border-sky-400/50 text-sky-100'
                                      : 'bg-white/5 hover:bg-primary/80 hover:border-primary/60 text-gray-200 border-white/10 disabled:opacity-60'
                                  }`}
                                >
                                  <span
                                    className={`shrink-0 min-w-[3.75rem] px-2 py-0.5 rounded text-[11px] font-mono font-bold tabular-nums text-center ${
                                      isBound
                                        ? 'bg-emerald-500/25 text-emerald-300'
                                        : isCurrentEp
                                        ? 'bg-sky-500/25 text-sky-300'
                                        : 'bg-black/40 text-primary group-hover:bg-white/20 group-hover:text-white'
                                    }`}
                                  >
                                    {parsed.badgeLabel}
                                  </span>

                                  <span className="flex-1 min-w-0 truncate text-xs text-gray-200 group-hover:text-white">
                                    {parsed.subTitle || parsed.cleanTitle || ep.episodeTitle}
                                  </span>

                                  {!dominantPlatform && parsed.platform && (
                                    <span className="shrink-0 text-[10px] font-mono text-gray-400 bg-black/35 px-1.5 py-0.5 rounded">
                                      {parsed.platform}
                                    </span>
                                  )}

                                  {isBindingThis ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                                  ) : isBound ? (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 text-[10px] font-semibold">
                                      已绑定
                                    </span>
                                  ) : isCurrentEp ? (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-sky-500/25 text-sky-300 text-[10px] font-semibold">
                                      当前集
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            ref={episodeListContainerRef}
                            className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-72 overflow-y-auto pt-0.5 pr-1 custom-scrollbar"
                          >
                            {filteredEpisodes.map(({ ep, index, parsed }) => {
                              const isBound =
                                currentBinding?.episodeId !== undefined &&
                                String(currentBinding.episodeId) === String(ep.episodeId);
                              const isCurrentEp =
                                effectiveEpisodeNumber !== undefined &&
                                effectiveEpisodeNumber > 0 &&
                                (parsed.episodeNumber === effectiveEpisodeNumber ||
                                  (parsed.episodeNumber === undefined &&
                                    index === effectiveEpisodeNumber - 1));
                              const isBindingThis =
                                bindingEpisodeId !== null &&
                                String(bindingEpisodeId) === String(ep.episodeId);
                              const hoverTitle = [
                                parsed.badgeLabel,
                                parsed.subTitle,
                                ep.episodeTitle !== parsed.cleanTitle
                                  ? `原始: ${ep.episodeTitle}`
                                  : null,
                                isBound ? '[已绑定]' : isCurrentEp ? '[当前播放集]' : null,
                              ]
                                .filter(Boolean)
                                .join(' · ');

                              return (
                                <button
                                  key={ep.episodeId}
                                  ref={(el) => {
                                    episodeBtnRefs.current[String(ep.episodeId)] = el;
                                  }}
                                  disabled={bindingEpisodeId !== null}
                                  onClick={() => handleSelectEpisodeAndBind(ep)}
                                  title={hoverTitle}
                                  className={`relative px-1.5 py-2 rounded-lg text-xs font-mono font-semibold tabular-nums truncate text-center transition border cursor-pointer disabled:cursor-wait ${
                                    isBindingThis
                                      ? 'bg-primary/30 border-primary text-white'
                                      : isBound
                                      ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 hover:bg-emerald-500/35'
                                      : isCurrentEp
                                      ? 'bg-sky-500/20 border-sky-400/70 text-sky-200 ring-1 ring-sky-400/40 hover:bg-sky-500/35'
                                      : 'bg-white/5 hover:bg-primary hover:text-white hover:border-primary text-gray-100 border-white/10 disabled:opacity-60'
                                  }`}
                                >
                                  {isBindingThis ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary mx-auto" />
                                  ) : (
                                    parsed.shortLabel
                                  )}
                                  {!isBindingThis && (isBound || isCurrentEp) && (
                                    <span
                                      className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${
                                        isBound ? 'bg-emerald-400' : 'bg-sky-400'
                                      }`}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
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
                    className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition flex items-center space-x-1 disabled:opacity-50 cursor-pointer"
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    <span>{loadingUrl ? '...' : '提取'}</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'time' && (
            <div className="space-y-5">
              <div className="bg-black/35 rounded-2xl p-5 border border-white/10 text-center">
                <span className="text-xs text-gray-400 block mb-1.5 font-medium">当前弹幕时间偏移</span>
                <div className="text-4xl font-mono font-bold text-primary tabular-nums tracking-tight">
                  {currentOffset > 0 ? `+${currentOffset.toFixed(1)}` : currentOffset.toFixed(1)}s
                </div>
                <p className="text-[11px] text-gray-400 mt-2.5 leading-relaxed">
                  正值代表弹幕提前出现，负值代表延后出现。支持播放时按键盘 <kbd className="px-1 rounded bg-white/10 text-white font-mono">G</kbd> / <kbd className="px-1 rounded bg-white/10 text-white font-mono">H</kbd> 秒速微调。
                </p>
              </div>

              {durationDiff && durationDiff > 10 && suggestedSignedOffset !== null && (
                <div className="p-3.5 bg-amber-500/15 border border-amber-500/30 rounded-xl text-amber-200 text-xs space-y-2.5">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                    <div className="leading-relaxed">
                      弹幕源时长 ({formatSec(sourceDuration)}) 与 Emby 视频 ({formatSec(videoDuration)}) 相差 {durationDiff} 秒，可能是片头前导长度不同所致。
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      bridge.offset = suggestedSignedOffset;
                      setItemOffset(itemId, suggestedSignedOffset);
                      showToast(
                        `已按时长差应用偏移 ${suggestedSignedOffset >= 0 ? `+${suggestedSignedOffset}` : suggestedSignedOffset}s`
                      );
                    }}
                    className="w-full py-1.5 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 font-semibold transition cursor-pointer border border-amber-400/30"
                  >
                    一键按时长差对齐 ({suggestedSignedOffset >= 0 ? `+${suggestedSignedOffset}s` : `${suggestedSignedOffset}s`})
                  </button>
                </div>
              )}

              <div className="space-y-2.5">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider block">
                  快捷微调 (5 档触感调节)
                </span>
                <div className="grid grid-cols-5 gap-1.5">
                  <button
                    onClick={() => adjustOffset(-5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-xl text-xs font-mono font-bold transition text-gray-200 tabular-nums border border-white/5 cursor-pointer"
                  >
                    -5s
                  </button>
                  <button
                    onClick={() => adjustOffset(-0.5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-xl text-xs font-mono font-bold transition text-gray-200 tabular-nums border border-white/5 cursor-pointer"
                  >
                    -0.5s
                  </button>
                  <button
                    onClick={resetOffset}
                    className="py-2.5 bg-primary/20 hover:bg-primary text-primary hover:text-white rounded-xl text-xs font-bold transition border border-primary/30 cursor-pointer shadow-sm"
                  >
                    重置
                  </button>
                  <button
                    onClick={() => adjustOffset(0.5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-xl text-xs font-mono font-bold transition text-gray-200 tabular-nums border border-white/5 cursor-pointer"
                  >
                    +0.5s
                  </button>
                  <button
                    onClick={() => adjustOffset(5)}
                    className="py-2.5 bg-white/5 hover:bg-white/15 rounded-xl text-xs font-mono font-bold transition text-gray-200 tabular-nums border border-white/5 cursor-pointer"
                  >
                    +5s
                  </button>
                </div>
              </div>

              {seriesId && (
                <button
                  onClick={applyOffsetToWholeSeries}
                  className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sky-300 text-xs font-medium border border-white/10 transition cursor-pointer"
                >
                  应用当前偏移 ({currentOffset >= 0 ? `+${currentOffset}` : currentOffset}s) 到本剧所有集数
                </button>
              )}
            </div>
          )}

          {activeTab === 'style' && (
            <div className="space-y-5">
              {/* 防刷屏与高能热力图开关 */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between p-3 rounded-xl bg-black/35 border border-white/10">
                  <div>
                    <div className="text-xs font-semibold text-white">重复弹幕智能合并防刷屏</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      3 秒内相同刷屏弹幕自动折叠为「文本 ×N」
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={danmakuSettings.mergeDuplicates}
                      onChange={(e) => updateDanmakuSettings({ mergeDuplicates: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary" />
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-black/35 border border-white/10">
                  <div className="flex items-center space-x-2">
                    <Flame className="w-4 h-4 text-sky-400 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold text-white">进度条高能弹幕密度曲线</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        识别名场面波峰并渲染于进度条上方
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={danmakuSettings.showHeatmap}
                      onChange={(e) => updateDanmakuSettings({ showHeatmap: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary" />
                  </label>
                </div>
              </div>

              {/* Danmaku Lines Setting */}
              <div className="space-y-2.5 pt-2 border-t border-white/10">
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
                      className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
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
                      className={`py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
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
                      className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
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

              {/* Opacity & Speed */}
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

              {/* Font Size, Weight & Stroke Width */}
              <div className="space-y-3 pt-2 border-t border-white/10">
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
                      className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                        danmakuSettings.fontSize === size
                          ? 'bg-primary text-white'
                          : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {size === 18 ? '小' : size === 24 ? '中' : size === 30 ? '大' : '特大'}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-gray-400 block">字重</span>
                    <div className="grid grid-cols-2 gap-1">
                      {(
                        [
                          { val: 'normal', label: '常规' },
                          { val: 'bold', label: '加粗' },
                        ] as const
                      ).map((w) => (
                        <button
                          key={w.val}
                          onClick={() => updateDanmakuSettings({ fontWeight: w.val })}
                          className={`py-1 rounded-lg text-[11px] transition cursor-pointer ${
                            danmakuSettings.fontWeight === w.val
                              ? 'bg-primary text-white font-semibold'
                              : 'bg-white/5 hover:bg-white/10 text-gray-300'
                          }`}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-gray-400 block">描边清晰度</span>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { val: 1.5, label: '细' },
                        { val: 2.5, label: '中' },
                        { val: 3.5, label: '粗' },
                      ].map((s) => (
                        <button
                          key={s.val}
                          onClick={() => updateDanmakuSettings({ strokeWidth: s.val })}
                          className={`py-1 rounded-lg text-[11px] transition cursor-pointer ${
                            danmakuSettings.strokeWidth === s.val
                              ? 'bg-primary text-white font-semibold'
                              : 'bg-white/5 hover:bg-white/10 text-gray-300'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Margin */}
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
                      className={`py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
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

              {/* Type Block Toggles */}
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
                    className="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium transition flex items-center space-x-1 cursor-pointer"
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
                          className="text-gray-400 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'list' && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                  placeholder="搜索本集名场面弹幕..."
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-primary text-white placeholder-gray-500"
                />
                <button
                  onClick={() => setNearCurrentOnly((prev) => !prev)}
                  className={`px-2.5 py-2 rounded-xl text-[11px] font-medium border transition cursor-pointer shrink-0 ${
                    nearCurrentOnly
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white/5 hover:bg-white/10 border-white/10 text-gray-300'
                  }`}
                  title="仅看当前进度前后 2 分钟内的弹幕"
                >
                  当前附近
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                <span>点击任意弹幕跳转进度 · 最多展示 200 条</span>
                <span className="font-mono">{rawComments.length} 条总计</span>
              </div>

              {parsedDanmuList.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  {rawComments.length === 0 ? '当前视频尚未加载弹幕' : '未检索到匹配弹幕'}
                </div>
              ) : (
                <div className="space-y-1">
                  {parsedDanmuList.map((item, idx) => (
                    <div
                      key={`${item.cid}-${idx}`}
                      className="group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-black/25 hover:bg-white/10 transition text-xs"
                    >
                      <button
                        onClick={() => onSeekToTime?.(item.time)}
                        className="flex-1 min-w-0 flex items-center space-x-2 text-left cursor-pointer"
                      >
                        <span className="font-mono text-[11px] text-sky-400 shrink-0 tabular-nums">
                          {formatSec(item.time)}
                        </span>
                        <span className="text-slate-200 group-hover:text-white truncate">
                          {item.text}
                        </span>
                      </button>
                      <button
                        onClick={() => handleQuickBlockText(item.text)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition cursor-pointer shrink-0"
                        title="屏蔽该条内容"
                      >
                        <ShieldBan className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <DanmuServerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
      />
    </>
  );
});

export default DanmakuDrawer;
