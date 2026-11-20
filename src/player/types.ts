import { MappedTrack } from '../api/embyClient';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended';

export type HwdecMode = 'auto-safe' | 'auto' | 'auto-copy' | 'no';
export type ToneMappingMode = 'auto' | 'bt.2446a' | 'spline' | 'hable' | 'clip';
export type VideoAspectPreset = 'auto' | '16:9' | '21:9' | '4:3' | 'fill';
export type StreamProxyOverride = 'follow' | 'direct' | 'proxy';

export interface ResolvedStreamProxyInfo {
  mode: 'lan_bypass' | 'direct' | 'system_http' | 'manual_http' | 'socks5_fallback_direct';
  effectiveProxy: string; // 实际传给 mpv http-proxy 的值（直连为空串）
  configuredProxy?: string; // 全局/服务器原始配置代理 URL（含 socks5）
  overrideMode: StreamProxyOverride;
  notice?: string; // 例如 socks5 无法直接用于 libmpv 的友好提示
}

export interface PlayerTelemetry {
  hwdecCurrent?: string; // e.g. 'd3d11va', 'videotoolbox', 'no'
  videoCodec?: string;
  fps?: number;
  droppedFrames?: number;
  cacheDuration?: number; // 前向缓冲秒数 (demuxer-cache-duration)
  bufferedEnd?: number; // 缓冲末端时间点 (demuxer-cache-time)
  cacheForwardBytes?: number; // 前向缓冲字节数 (demuxer-cache-state['fw-bytes'])
}

export interface PlayerLoadOptions {
  url: string;
  initialTime?: number;
  title?: string;
  headers?: Record<string, string>;
  isLive?: boolean;
  proxyOverride?: StreamProxyOverride;
}

export interface IPlayerEngine {
  readonly state: PlayerState;
  readonly currentTime: number;
  readonly duration: number;
  readonly volume: number;
  readonly playbackRate: number;
  readonly paused: boolean;

  /**
   * 初始化播放引擎，可挂载宿主容器或原生窗口
   */
  init(container: HTMLElement | null): Promise<void>;

  /**
   * 加载媒体资源
   */
  load(options: PlayerLoadOptions): Promise<void>;

  /**
   * 播放
   */
  play(): Promise<void>;

  /**
   * 暂停
   */
  pause(): Promise<void>;

  /**
   * 切换播放/暂停
   */
  togglePlay(): Promise<void>;

  /**
   * 跳转时间（秒）
   */
  seek(targetSeconds: number): Promise<void>;

  /**
   * 设置音量 (0 ~ 200，>100 为软增益)
   */
  setVolume(volume: number): Promise<void>;

  /**
   * 设置倍速 (0.5 ~ 3.0)
   */
  setPlaybackRate(rate: number): Promise<void>;

  /**
   * 选择音频流
   */
  selectAudioTrack(trackId: string): Promise<void>;

  /**
   * 选择字幕流 (null 为关闭字幕)
   */
  selectSubtitleTrack(trackId: string | null): Promise<void>;

  /**
   * 宽银幕底对齐设置 (0 ~ 100, 默认 100 紧贴底部, 50 为居中)
   */
  setVideoAlignment(verticalOffsetPercent: number, bottomAlign: boolean): Promise<void>;

  /**
   * 销毁并释放播放器资源
   */
  destroy(): Promise<void>;

  // 事件监听器（返回解绑函数）
  onTimeUpdate(cb: (currentTime: number, duration: number) => void): () => void;
  onStateChange(cb: (state: PlayerState) => void): () => void;
  onError(cb: (errorMsg: string) => void): () => void;
  onVideoDimensions(cb: (width: number, height: number) => void): () => void;
  onTracksLoaded(cb: (audio: MappedTrack[], subtitles: MappedTrack[]) => void): () => void;
  onNetworkSpeed?(cb: (speedBytesPerSec: number) => void): () => void;
  onTelemetry?(cb: (telemetry: PlayerTelemetry) => void): () => void;
  onProxyResolved?(cb: (info: ResolvedStreamProxyInfo) => void): () => void;

  // Pro 控制能力（主要在 libmpv 原生硬解引擎下生效）
  setHwdecMode?(mode: HwdecMode): Promise<void>;
  setVideoAspect?(preset: VideoAspectPreset): Promise<void>;
  setVideoEnhancement?(opts: {
    toneMapping?: ToneMappingMode;
    deband?: boolean;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    gamma?: number;
  }): Promise<void>;
  setAudioEnhancement?(opts: {
    audioDelay?: number;
    nightMode?: boolean;
    volumeMax?: number;
  }): Promise<void>;
  setSubtitleStyle?(opts: { delay?: number; scale?: number; pos?: number }): Promise<void>;
  selectSecondarySubtitleTrack?(trackId: string | null): Promise<void>;
  addExternalSubtitle?(pathOrUrl: string): Promise<void>;
  frameStep?(direction: 'forward' | 'backward'): Promise<void>;
  setAbLoop?(point: 'a' | 'b' | 'clear', seconds?: number): Promise<void>;
  takeScreenshot?(directory: string, mode?: 'subtitles' | 'video'): Promise<void>;
}
