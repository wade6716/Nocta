import { IPlayerEngine, PlayerLoadOptions, PlayerState } from './types';
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
      this.setState('buffering');
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
      if (!this.video) return;
      this._currentTime = this.video.currentTime;
      this.timeUpdateListeners.forEach((cb) => cb(this._currentTime, this.duration));
    };

    this.video.ondurationchange = () => {
      if (!this.video) return;
      this._duration = this.video.duration || 0;
    };

    this.video.onerror = () => {
      const err = this.video?.error?.message || '视频加载或解码发生未知错误';
      this.setState('idle');
      this.errorListeners.forEach((cb) => cb(err));
    };
  }

  async load(options: PlayerLoadOptions): Promise<void> {
    if (!this.video) return;

    this.setState('loading');
    this.video.src = options.url;
    this.video.playbackRate = this._playbackRate;
    this.video.volume = this._volume / 100;

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

  async destroy(): Promise<void> {
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
}
