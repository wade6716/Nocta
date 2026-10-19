import { MappedTrack } from '../api/embyClient';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended';

export interface PlayerLoadOptions {
  url: string;
  initialTime?: number;
  title?: string;
  headers?: Record<string, string>;
  isLive?: boolean;
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
   * 设置音量 (0 ~ 100)
   */
  setVolume(volume: number): Promise<void>;

  /**
   * 设置倍速 (0.5 ~ 2.0)
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
}
