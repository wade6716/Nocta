import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmbyItem, ticksToSeconds } from '../../api/embyClient';
import {
  autoMatchEpisode,
  computeDanmakuHeatmap,
  fetchCommentsById,
  parseDanmuEpisodeInfo,
  RawDanmuComment,
  transformToDanmakuItems,
} from '../../api/danmuClient';
import { MpvDanmakuBridge } from '../../components/player/MpvDanmakuBridge';
import { DanmuServerEntry } from '../../stores/useDanmuStore';
import { usePlayerStore } from '../../stores/usePlayerStore';

interface UseDanmakuSessionParams {
  item: EmbyItem | null;
  itemId?: string;
  effectiveDuration: number;
  bridge: MpvDanmakuBridge;
  activeDanmuServer: DanmuServerEntry;
}

/**
 * 管理弹幕加载会话、同剧延续绑定、并发切集竞态锁、零闪烁弹幕格式化与热度密度曲线。
 */
export function useDanmakuSession({
  item,
  itemId,
  effectiveDuration,
  bridge,
  activeDanmuServer,
}: UseDanmakuSessionParams) {
  const danmakuSettings = usePlayerStore((s) => s.danmakuSettings);
  const itemOffsets = usePlayerStore((s) => s.itemOffsets);
  const seriesOffsets = usePlayerStore((s) => s.seriesOffsets);
  const danmakuBindings = usePlayerStore((s) => s.danmakuBindings);
  const seriesDanmakuBindings = usePlayerStore((s) => s.seriesDanmakuBindings);

  const [rawComments, setRawComments] = useState<RawDanmuComment[]>([]);
  const [matchedTitle, setMatchedTitle] = useState<string>('');
  const [sourceDuration, setSourceDuration] = useState<number | undefined>();
  const [danmuToast, setDanmuToast] = useState<string | null>(null);
  const [durationAlert, setDurationAlert] = useState<string | null>(null);

  const danmakuReqIdRef = useRef(0);
  const activeItemIdRef = useRef<string | undefined>(item?.Id);
  const danmuToastTimerRef = useRef<number | null>(null);

  activeItemIdRef.current = item?.Id;

  const showToast = useCallback((msg: string) => {
    setDanmuToast(msg);
    if (danmuToastTimerRef.current) {
      window.clearTimeout(danmuToastTimerRef.current);
    }
    danmuToastTimerRef.current = window.setTimeout(() => {
      setDanmuToast(null);
      danmuToastTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      danmakuReqIdRef.current += 1;
      if (danmuToastTimerRef.current) {
        window.clearTimeout(danmuToastTimerRef.current);
      }
    };
  }, []);

  // 单集偏移优先，否则继承整剧偏移
  const savedOffset =
    (itemId && itemOffsets[itemId] !== undefined
      ? itemOffsets[itemId]
      : item?.SeriesId
      ? seriesOffsets[item.SeriesId]
      : 0) || 0;

  // Danmaku bridge offset lifecycle
  useEffect(() => {
    bridge.offset = savedOffset;
    return () => {
      bridge.reset();
    };
  }, [bridge, savedOffset]);

  // 精确拆分 useMemo 依赖，彻底消除调节透明度/速度/行数/区域/显示开关时的 Canvas 重建闪烁 Bug
  const formattedComments = useMemo(() => {
    if (rawComments.length === 0) return [];
    return transformToDanmakuItems(rawComments, {
      fontSize: danmakuSettings.fontSize,
      fontWeight: danmakuSettings.fontWeight,
      strokeWidth: danmakuSettings.strokeWidth,
      colorMode: danmakuSettings.colorMode,
      blockScroll: danmakuSettings.blockScroll,
      blockTop: danmakuSettings.blockTop,
      blockBottom: danmakuSettings.blockBottom,
      blockColor: danmakuSettings.blockColor,
      blockedWords: danmakuSettings.blockedWords,
      mergeDuplicates: danmakuSettings.mergeDuplicates,
    });
  }, [
    rawComments,
    danmakuSettings.fontSize,
    danmakuSettings.fontWeight,
    danmakuSettings.strokeWidth,
    danmakuSettings.colorMode,
    danmakuSettings.blockScroll,
    danmakuSettings.blockTop,
    danmakuSettings.blockBottom,
    danmakuSettings.blockColor,
    danmakuSettings.blockedWords,
    danmakuSettings.mergeDuplicates,
  ]);

  // 进度条高能弹幕密度曲线
  const danmakuHeatmap = useMemo(() => {
    if (!danmakuSettings.showHeatmap || rawComments.length === 0 || effectiveDuration <= 0) {
      return [];
    }
    return computeDanmakuHeatmap(rawComments, effectiveDuration, 100);
  }, [rawComments, effectiveDuration, danmakuSettings.showHeatmap]);

  // 切换条目时立即清空上一条目的弹幕与偏差提示，防止旧集弹幕短暂残留或错位
  useEffect(() => {
    danmakuReqIdRef.current += 1;
    setRawComments([]);
    setMatchedTitle('');
    setSourceDuration(undefined);
    setDurationAlert(null);
  }, [item?.Id]);

  const triggerDanmakuLoad = useCallback(
    async (forceAuto = false) => {
      if (!item) return;

      const reqId = ++danmakuReqIdRef.current;
      const targetItemId = item.Id;
      const isStale = () =>
        reqId !== danmakuReqIdRef.current || activeItemIdRef.current !== targetItemId;

      const embyDurationSec = ticksToSeconds(item.RunTimeTicks || 0);
      const updateDurationAlert = (dur?: number) => {
        if (dur && embyDurationSec > 0) {
          const diff = Math.round(Math.abs(dur - embyDurationSec));
          if (diff > 15) {
            setDurationAlert(`片源与弹幕源时长相差 ${diff} 秒，可在弹幕抽屉「校准」中一键对齐。`);
            return;
          }
        }
        setDurationAlert(null);
      };

      const currentBinding = itemId && !forceAuto ? danmakuBindings[itemId] : undefined;
      if (currentBinding) {
        setMatchedTitle(`《${currentBinding.animeTitle}》${currentBinding.episodeTitle}`);
        setSourceDuration(currentBinding.sourceDuration);
        try {
          const res = await fetchCommentsById(activeDanmuServer, currentBinding.episodeId);
          if (isStale()) return;
          setRawComments(res.comments || []);
          if (res.videoDuration) setSourceDuration(res.videoDuration);
          showToast(
            `已加载绑定弹幕: 《${currentBinding.animeTitle}》${currentBinding.episodeTitle} (${res.comments?.length || 0}条)`
          );
          updateDurationAlert(res.videoDuration || currentBinding.sourceDuration);
          return;
        } catch (err) {
          if (isStale()) return;
          console.warn('加载绑定弹幕失败，尝试同剧/自动匹配', err);
        }
      }

      // 优先检查同剧集番剧绑定延续（无需每集手动重复搜番）
      const seriesBinding =
        !forceAuto && item.SeriesId ? seriesDanmakuBindings[item.SeriesId] : undefined;
      if (seriesBinding && seriesBinding.episodes?.length > 0 && item.IndexNumber !== undefined) {
        const epNum = item.IndexNumber;
        const matchedEp =
          seriesBinding.episodes.find((ep, idx) => {
            const parsed = parseDanmuEpisodeInfo(ep, idx);
            return parsed.episodeNumber === epNum;
          }) || seriesBinding.episodes[epNum - 1];

        if (matchedEp) {
          try {
            const res = await fetchCommentsById(activeDanmuServer, matchedEp.episodeId);
            if (isStale()) return;
            setMatchedTitle(`《${seriesBinding.animeTitle}》${matchedEp.episodeTitle}`);
            setSourceDuration(res.videoDuration);
            setRawComments(res.comments || []);
            if (res.comments && res.comments.length > 0) {
              showToast(
                `同剧延续弹幕: 《${seriesBinding.animeTitle}》${matchedEp.episodeTitle} (${res.comments.length}条)`
              );
            }
            updateDurationAlert(res.videoDuration);
            return;
          } catch (err) {
            if (isStale()) return;
            console.warn('同剧延续弹幕失败，回退自动匹配', err);
          }
        }
      }

      // 智能自动匹配
      try {
        const match = await autoMatchEpisode(activeDanmuServer, {
          seriesName: item.SeriesName,
          seasonNumber: item.ParentIndexNumber,
          episodeNumber: item.IndexNumber,
          fileName: item.Name,
        });
        if (isStale()) return;

        if (!match) {
          setMatchedTitle('');
          setRawComments([]);
          return;
        }

        const titleText =
          `${match.animeTitle || ''} ${match.episodeTitle || ''}`.trim() || `ID: ${match.episodeId}`;
        setMatchedTitle(titleText);

        const res = await fetchCommentsById(activeDanmuServer, match.episodeId);
        if (isStale()) return;

        setRawComments(res.comments || []);
        setSourceDuration(res.videoDuration);

        if (res.comments && res.comments.length > 0) {
          showToast(
            `已自动匹配弹幕: ${match.animeTitle ? `《${match.animeTitle}》` : ''} (${res.comments.length}条)`
          );
        }
        updateDurationAlert(res.videoDuration);
      } catch (err) {
        if (!isStale()) {
          console.warn('弹幕自动匹配失败', err);
        }
      }
    },
    [
      item?.Id,
      item?.SeriesId,
      item?.SeriesName,
      item?.ParentIndexNumber,
      item?.IndexNumber,
      item?.Name,
      item?.RunTimeTicks,
      itemId,
      danmakuBindings,
      seriesDanmakuBindings,
      activeDanmuServer,
      showToast,
    ]
  );

  useEffect(() => {
    triggerDanmakuLoad();
  }, [triggerDanmakuLoad]);

  const handleCommentsLoaded = useCallback(
    (
      newComments: RawDanmuComment[],
      sDur?: number,
      meta?: { animeTitle: string; episodeTitle: string; episodeId: number | string }
    ) => {
      // 使之前仍在飞行中的自动匹配请求失效，避免覆盖手动选择的弹幕源
      danmakuReqIdRef.current += 1;
      setRawComments(newComments);
      if (sDur) setSourceDuration(sDur);
      if (meta) {
        setMatchedTitle(`《${meta.animeTitle}》${meta.episodeTitle}`);
        showToast(
          `已切换并绑定弹幕: 《${meta.animeTitle}》${meta.episodeTitle} (${newComments.length}条)`
        );
      }
      if (sDur && item?.RunTimeTicks) {
        const embyDurationSec = ticksToSeconds(item.RunTimeTicks);
        const diff = Math.round(Math.abs(sDur - embyDurationSec));
        if (diff > 15) {
          setDurationAlert(`弹幕源时长相差 ${diff} 秒，可在校准页面一键按时长差对齐。`);
        } else {
          setDurationAlert(null);
        }
      }
    },
    [item?.RunTimeTicks, showToast]
  );

  return {
    danmakuSettings,
    rawComments,
    matchedTitle,
    sourceDuration,
    danmuToast,
    durationAlert,
    setDurationAlert,
    savedOffset,
    formattedComments,
    danmakuHeatmap,
    triggerDanmakuLoad,
    handleCommentsLoaded,
  };
}
