import React, { useEffect, useRef } from 'react';
import Danmaku from 'danmaku';
import { MpvDanmakuBridge } from './MpvDanmakuBridge';
import { FormattedDanmakuItem } from '../../api/danmuClient';

interface DanmakuLayerProps {
  bridge: MpvDanmakuBridge;
  comments: FormattedDanmakuItem[];
  visible: boolean;
  speed?: number; // 默认 144
  opacity?: number; // 0.1 ~ 1.0
  area?: number; // 0.25 | 0.5 | 0.75 | 1.0
  maxLines?: number; // 0 为不限行数
  bottomMargin?: number; // 底部避让距离
}

export const DanmakuLayer: React.FC<DanmakuLayerProps> = ({
  bridge,
  comments,
  visible,
  speed = 144,
  opacity = 0.85,
  area = 0.75,
  maxLines = 0,
  bottomMargin = 48,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const danmakuInstanceRef = useRef<Danmaku | null>(null);

  // 初始化或当 comments/bridge 引用变动时重建弹幕实例
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let resizeObserver: ResizeObserver | null = null;
    try {
      const instance = new Danmaku({
        container,
        media: bridge,
        comments: comments as any,
        engine: 'canvas',
        speed,
        area,
        opacity,
        maxLines,
        bottomMargin,
      });

      if (!visible) {
        instance.hide();
      }

      danmakuInstanceRef.current = instance;

      // 关键避坑点 9：监听窗口全屏或尺寸变化，自动同步 Canvas 舞台尺寸
      resizeObserver = new ResizeObserver(() => {
        try {
          instance.resize();
        } catch (e) {
          console.warn(e);
        }
      });
      resizeObserver.observe(container);
    } catch (err) {
      console.error('[DanmakuLayer Init Error]', err);
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      if (danmakuInstanceRef.current) {
        try {
          danmakuInstanceRef.current.destroy();
        } catch (e) {
          console.warn(e);
        }
        danmakuInstanceRef.current = null;
      }
    };
  }, [bridge, comments]);

  // 动态响应可见性切换
  useEffect(() => {
    const inst = danmakuInstanceRef.current;
    if (!inst) return;
    visible ? inst.show() : inst.hide();
  }, [visible]);

  // 动态响应速度、区域、行数、避让与透明度变化
  useEffect(() => {
    const inst = danmakuInstanceRef.current;
    if (!inst) return;
    inst.speed = speed;
    inst.area = area;
    inst.opacity = opacity;
    inst.maxLines = maxLines;
    inst.bottomMargin = bottomMargin;
  }, [speed, area, opacity, maxLines, bottomMargin]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none"
    />
  );
};

export default DanmakuLayer;
