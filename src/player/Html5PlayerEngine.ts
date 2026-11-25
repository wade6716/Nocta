import { IPlayerEngine, PlayerLoadOptions, PlayerState, PlayerTelemetry } from './types';
import { MappedTrack } from '../api/embyClient';

export class Html5PlayerEngine implements IPlayerEngine {
  private video: HTMLVideoElement | null = null;
  private container: HTMLElement | null = null;
  private ownVideoElement = false;

  private _state: PlayerState = 'idle';
  private _currentTime = 0;
  private _duration = 0;
  private _volume = 100;
  private _playbackRate = 1.0;
  private _paused = true;

  private timeUpdateListeners: Set<(currentTime: number, duration: number) => void> = new Set();
  private stateChangeListeners: Set<(state: PlayerState) => void> = new Set();
  private errorListeners: Set<(errorMsg: string) => void> = new Set();
  private videoDimensionsListeners: Set<(width: number, height: number) => void> = new Set();
  private tracksLoadedListeners: Set<(audio: MappedTrack[], subtitles: MappedTrack[]) => void> = new Set();
  private networkSpeedListeners: Set<(speed: number) => void> = new Set();
  private telemetryListeners: Set<(telemetry: PlayerTelemetry) => void> = new Set();
  private speedPollTimer: number | null = null;
  private lastBufferedEnd = 0;
  private lastProgressCheckTime = 0;
  private mediaBitrateBps = 8_000_000;

  get state(): PlayerState {
    return this._state;
  }
  get currentTime(): number {
    return this.video ? this.video.currentTime : this._currentTime;
  }
  get duration(): number {
    return this.video ? this.video.duration || this._duration : this._duration;
  }
  get volume(): number {
    return this._volume;
  }
  get playbackRate(): number {
    return this._playbackRate;
  }
  get paused(): boolean {
    return this.video ? this.video.paused : this._paused;
  }

  async init(container: HTMLElement | null): Promise<void> {
    this.container = container;
    if (!container) return;

    // 如果容器内已存在 video 标签，复用它；否则创建新 video 标签
    const existingVideo = container.querySelector('video');
    if (existingVideo) {
      this.video = existingVideo;
      this.ownVideoElement = false;
    } else {
      this.video = document.createElement('video');
      this.video.className = 'w-full h-full object-contain pointer-events-none transition-[object-position] duration-200';
      this.video.autoplay = true;
      this.video.playsInline = true;
      container.appendChild(this.video);
      this.ownVideoElement = true;
    }

    this.bindVideoEvents();
  }

  private bindVideoEvents() {
    if (!this.video) return;

    this.video.onloadedmetadata = () => {
      if (!this.video) return;
      this._duration = this.video.duration || 0;
      if (this.video.videoWidth && this.video.videoHeight) {
        this.videoDimensionsListeners.forEach((cb) =>
          cb(this.video!.videoWidth, this.video!.videoHeight)
        );
      }
    };

    this.video.onwaiting = () => {
      if (this._state !== 'loading' && !this._paused) {
        this.setState('buffering');
      }
    };

    this.video.onplaying = () => {
      this._paused = false;
      this.setState('playing');
    };

    this.video.onplay = () => {
      this._paused = false;
      this.setState('playing');
    };

    this.video.onpause = () => {
      this._paused = true;
      this.setState('paused');
    };

    this.video.onended = () => {
      this._paused = true;
      this.setState('ended');
    };

    this.video.ontimeupdate = () => {
      if (!this.video || (this._state === 'loading' && this.video.readyState < 1)) return;
      this._currentTime = this.video.currentTime;
      this.timeUpdateListeners.forEach((cb) => cb(this._currentTime, this.duration));
    };

    this.video.ondurationchange = () => {
      if (!this.video) return;
      this._duration = this.video.duration || 0;
    };

    this.video.onerror = () => {
      const code = this.video?.error?.code;
      let err = '当前视频格式或编码不受浏览器支持';
      if (code === 4) {
        err = '浏览器内核不支持该片源格式或编码 (MEDIA_ERR_SRC_NOT_SUPPORTED)';
      } else if (code === 3) {
        err = '视频解码错误 (MEDIA_ERR_DECODE)';
      } else if (code === 2) {
        err = '网络传输错误 (MEDIA_ERR_NETWORK)';
      }
      this.setState('idle');
      this.errorListeners.forEach((cb) => cb(err));
    };
  }

  async load(options: PlayerLoadOptions): Promise<void> {
    if (!this.video) return;

    this.mediaBitrateBps =
      options.bufferConfig?.mediaBitrateBps && options.bufferConfig.mediaBitrateBps > 0
        ? options.bufferConfig.mediaBitrateBps
        : 8_000_000;
    this.lastBufferedEnd = 0;
    this._currentTime = 0;
    this._duration = 0;
    this.startSpeedPolling();
    this.setState('loading');
    this.video.src = options.url;
    this.video.playbackRate = this._playbackRate;
    this.video.volume = Math.min(1, Math.max(0, this._volume / 100));

    if (options.initialTime && options.initialTime > 0) {
      const onFirstReady = () => {
        if (!this.video) return;
        this.video.currentTime = options.initialTime!;
        this._currentTime = options.initialTime!;
        this.video.removeEventListener('canplay', onFirstReady);
        this.video.removeEventListener('loadedmetadata', onFirstReady);
      };
      this.video.addEventListener('canplay', onFirstReady, { once: true });
      this.video.addEventListener('loadedmetadata', onFirstReady, { once: true });
    }

    try {
      await this.video.play();
      this._paused = false;
      this.setState('playing');
    } catch {
      // 允许自动播放受限静音或点击后再播放
      this._paused = true;
      this.setState('paused');
    }
  }

  async play(): Promise<void> {
    if (!this.video) return;
    try {
      await this.video.play();
      this._paused = false;
      this.setState('playing');
    } catch (e: any) {
      console.warn('[Html5Engine Play Error]', e);
    }
  }

  async pause(): Promise<void> {
    if (!this.video) return;
    this.video.pause();
    this._paused = true;
    this.setState('paused');
  }

  async togglePlay(): Promise<void> {
    if (this.paused) {
      await this.play();
    } else {
      await this.pause();
    }
  }

  async seek(targetSeconds: number): Promise<void> {
    if (!this.video) return;
    this.video.currentTime = targetSeconds;
    this._currentTime = targetSeconds;
    this.timeUpdateListeners.forEach((cb) => cb(targetSeconds, this.duration));
  }

  async setVolume(volume: number): Promise<void> {
    this._volume = Math.max(0, Math.min(100, volume));
    if (this.video) {
      this.video.volume = this._volume / 100;
    }
  }

  async setPlaybackRate(rate: number): Promise<void> {
    this._playbackRate = rate;
    if (this.video) {
      this.video.playbackRate = rate;
    }
  }

  async selectAudioTrack(_trackId: string): Promise<void> {
    // HTML5 <video> 在普通流模式下通常依赖转码流重载，无法直接无缝切内嵌非 HLS 音轨
    console.warn('[Html5Engine] Track switching via HTML5 requires stream reload');
  }

  async selectSubtitleTrack(_trackId: string | null): Promise<void> {
    console.warn('[Html5Engine] Subtitle switching via HTML5 requires subtitle elements');
  }

  async setVideoAlignment(verticalOffsetPercent: number, bottomAlign: boolean): Promise<void> {
    if (!this.video) return;
    this.video.style.objectPosition = bottomAlign
      ? `center ${verticalOffsetPercent}%`
      : 'center center';
  }

  private startSpeedPolling() {
    if (this.speedPollTimer !== null) return;
    this.lastProgressCheckTime = performance.now();
    this.speedPollTimer = window.setInterval(() => {
      if (!this.video || this._state === 'idle') {
        this.networkSpeedListeners.forEach((cb) => cb(0));
        return;
      }
      const now = performance.now();
      const dt = (now - this.lastProgressCheckTime) / 1000;
      this.lastProgressCheckTime = now;

      let speed = 0;
      if (this.video.buffered.length > 0 && dt > 0) {
        let maxBufferedEnd = 0;
        for (let i = 0; i < this.video.buffered.length; i++) {
          const end = this.video.buffered.end(i);
          if (end > maxBufferedEnd) maxBufferedEnd = end;
        }
        const deltaSec = Math.max(0, maxBufferedEnd - this.lastBufferedEnd);
        this.lastBufferedEnd = maxBufferedEnd;

        // 若缓冲向前延伸，按当前片源码率（缺失时按 8 Mbps）估算下载速率
        if (deltaSec > 0) {
          speed = (deltaSec * (this.mediaBitrateBps / 8)) / dt;
        }
        const cacheDur = Math.max(0, maxBufferedEnd - (this.video.currentTime || 0));
        this.telemetryListeners.forEach((cb) =>
          cb({
            hwdecCurrent: 'browser',
            bufferedEnd: maxBufferedEnd,
            cacheDuration: cacheDur,
          })
        );
      }
      this.networkSpeedListeners.forEach((cb) => cb(speed));
    }, 1000);
  }

  private stopSpeedPolling() {
    if (this.speedPollTimer !== null) {
      window.clearInterval(this.speedPollTimer);
      this.speedPollTimer = null;
    }
  }

  async destroy(): Promise<void> {
    this.stopSpeedPolling();
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.load();
      if (this.ownVideoElement && this.video.parentElement) {
        this.video.parentElement.removeChild(this.video);
      }
      this.video = null;
    }
    this.timeUpdateListeners.clear();
    this.stateChangeListeners.clear();
    this.errorListeners.clear();
    this.videoDimensionsListeners.clear();
    this.tracksLoadedListeners.clear();
    this.networkSpeedListeners.clear();
    this.telemetryListeners.clear();
    this._state = 'idle';
  }

  private setState(nextState: PlayerState) {
    if (this._state === nextState) return;
    this._state = nextState;
    this.stateChangeListeners.forEach((cb) => cb(nextState));
  }

  onTimeUpdate(cb: (currentTime: number, duration: number) => void): () => void {
    this.timeUpdateListeners.add(cb);
    return () => this.timeUpdateListeners.delete(cb);
  }

  onStateChange(cb: (state: PlayerState) => void): () => void {
    this.stateChangeListeners.add(cb);
    return () => this.stateChangeListeners.delete(cb);
  }

  onError(cb: (errorMsg: string) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onVideoDimensions(cb: (width: number, height: number) => void): () => void {
    this.videoDimensionsListeners.add(cb);
    return () => this.videoDimensionsListeners.delete(cb);
  }

  onTracksLoaded(cb: (audio: MappedTrack[], subtitles: MappedTrack[]) => void): () => void {
    this.tracksLoadedListeners.add(cb);
    return () => this.tracksLoadedListeners.delete(cb);
  }

  onNetworkSpeed(cb: (speedBytesPerSec: number) => void): () => void {
    this.networkSpeedListeners.add(cb);
    cb(0);
    return () => this.networkSpeedListeners.delete(cb);
  }

  onTelemetry(cb: (telemetry: PlayerTelemetry) => void): () => void {
    this.telemetryListeners.add(cb);
    return () => this.telemetryListeners.delete(cb);
  }
}
