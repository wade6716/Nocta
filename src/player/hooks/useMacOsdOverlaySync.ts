import { MutableRefObject, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { FormattedDanmakuItem } from '../../api/danmuClient';
import {
  OSD_OVERLAY_COMMENTS_EVENT,
  OSD_OVERLAY_COMMAND_EVENT,
  OSD_OVERLAY_READY_EVENT,
  OSD_OVERLAY_SYNC_EVENT,
  OsdCommand,
  OsdSyncPayload,
} from '../osdOverlaySync';

interface UseMacOsdOverlaySyncParams {
  canUseMacOsdOverlay: boolean;
  isFullscreen: boolean;
  videoError: string | null;
  syncPayload: OsdSyncPayload | null;
  liveTimeRef: MutableRefObject<number>;
  formattedComments: FormattedDanmakuItem[];
  onCommand: (cmd: OsdCommand) => void;
}

/**
 * macOS 原生全屏下 `osd-overlay` 透明浮层窗口的生命周期管理与状态双向同步。
 */
export function useMacOsdOverlaySync({
  canUseMacOsdOverlay,
  isFullscreen,
  videoError,
  syncPayload,
  liveTimeRef,
  formattedComments,
  onCommand,
}: UseMacOsdOverlaySyncParams) {
  const [osdOverlayActive, setOsdOverlayActive] = useState(false);

  const osdSyncPayloadRef = useRef<OsdSyncPayload | null>(null);
  const osdCommentsRef = useRef<FormattedDanmakuItem[]>([]);
  const osdCommandHandlerRef = useRef<(cmd: OsdCommand) => void>(() => {});

  osdSyncPayloadRef.current = syncPayload;
  osdCommentsRef.current = formattedComments;
  osdCommandHandlerRef.current = onCommand;

  useEffect(() => {
    if (!canUseMacOsdOverlay) {
      setOsdOverlayActive(false);
      return;
    }

    let cancelled = false;
    if (isFullscreen && !videoError) {
      invoke('open_osd_overlay')
        .then(() => {
          if (cancelled) {
            invoke('close_osd_overlay').catch(() => {});
            return;
          }
          setOsdOverlayActive(true);
        })
        .catch((err) => {
          console.warn('[OSD Overlay] open failed:', err);
          setOsdOverlayActive(false);
        });
    } else {
      invoke('close_osd_overlay').catch(() => {});
      setOsdOverlayActive(false);
    }

    return () => {
      cancelled = true;
    };
  }, [canUseMacOsdOverlay, isFullscreen, videoError]);

  useEffect(() => {
    if (!canUseMacOsdOverlay) return;
    return () => {
      invoke('close_osd_overlay').catch(() => {});
    };
  }, [canUseMacOsdOverlay]);

  useEffect(() => {
    if (!osdOverlayActive) return;

    const pushSync = () => {
      const payload = osdSyncPayloadRef.current;
      if (!payload) return;
      void emit(OSD_OVERLAY_SYNC_EVENT, {
        ...payload,
        currentTime: liveTimeRef.current ?? payload.currentTime,
      });
    };

    pushSync();
    const timer = window.setInterval(pushSync, 200);
    const unlistenReady = listen(OSD_OVERLAY_READY_EVENT, () => {
      pushSync();
      void emit(OSD_OVERLAY_COMMENTS_EVENT, osdCommentsRef.current);
    });

    return () => {
      window.clearInterval(timer);
      unlistenReady.then((unlisten) => unlisten());
    };
  }, [osdOverlayActive, liveTimeRef]);

  useEffect(() => {
    if (!osdOverlayActive) return;
    void emit(OSD_OVERLAY_COMMENTS_EVENT, formattedComments);
  }, [osdOverlayActive, formattedComments]);

  useEffect(() => {
    if (!osdOverlayActive) return;
    const unlisten = listen<OsdCommand>(OSD_OVERLAY_COMMAND_EVENT, (event) => {
      osdCommandHandlerRef.current(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [osdOverlayActive]);

  return { osdOverlayActive };
}
