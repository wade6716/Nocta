import {
  init,
  destroy,
  observeProperties,
  listenEvents,
  command,
  setProperty,
  MpvConfig,
  MpvObservableProperty,
} from 'tauri-plugin-libmpv-api';
import { UnlistenFn } from '@tauri-apps/api/event';
import { IPlayerEngine, PlayerLoadOptions, PlayerState } from './types';
import { MappedTrack } from '../api/embyClient';

const OBSERVED_PROPERTIES = [
  ['pause', 'flag'],
  ['time-pos', 'double', 'none'],
  ['duration', 'double', 'none'],
  ['paused-for-cache', 'flag'],
  ['speed', 'double'],
  ['volume', 'double'],
  ['dwidth', 'int64', 'none'],
  ['dheight', 'int64', 'none'],
  ['track-list', 'node', 'none'],
] as const satisfies readonly MpvObservableProperty[];

export class MpvPlayerEngine implements IPlayerEngine {
  private unlisten: UnlistenFn | null = null;
  private unlistenEvents: UnlistenFn | null = null;
  private isInitialized = false;

  private _state: PlayerState = 'idle';
  private _currentTime = 0;
  private _duration = 0;
  private _volume = 100;
  private _playbackRate = 1.0;
  private _paused = true;
  private _isBuffering = false;
  private _videoWidth = 0;
  private _videoHeight = 0;

  private timeUpdateListeners: Set<(currentTime: number, duration: number) => void> = new Set();
  private stateChangeListeners: Set<(state: PlayerState) => void> = new Set();
  private errorListeners: Set<(errorMsg: string) => void> = new Set();
  private videoDimensionsListeners: Set<(width: number, height: number) => void> = new Set();
  private tracksLoadedListeners: Set<(audio: MappedTrack[], subtitles: MappedTrack[]) => void> = new Set();

  get state(): PlayerState {
    return this._state;
  }
  get currentTime(): number {
    return this._currentTime;
  }
  get duration(): number {
    return this._duration;
  }
  get volume(): number {
    return this._volume;
  }
  get playbackRate(): number {
    return this._playbackRate;
  }
  get paused(): boolean {
    return this._paused;
  }

  async init(_container: HTMLElement | null): Promise<void> {
    if (this.isInitialized) return;

    const mpvConfig: MpvConfig = {
      initialOptions: {
        vo: 'gpu-next,gpu',
        hwdec: 'auto-safe',
        'keep-open': 'yes',
        'force-window': 'yes',
        panscan: '0.0',
        'autofit-larger': '100%x100%',
        osc: 'no',
        'osd-level': '0',
        'input-default-bindings': 'no',
        'input-vo-keyboard': 'no',
      },
      observedProperties: OBSERVED_PROPERTIES,
    };

    try {
      await init(mpvConfig);
      this.isInitialized = true;
      this.bindMpvEvents();
    } catch (err: any) {
      console.error('[MpvEngine Init Error]', err);
      throw new Error(`初始化 libmpv 原生内核失败: ${err?.message || err}`);
    }
  }

  private async bindMpvEvents() {
    try {
      this.unlisten = await observeProperties(OBSERVED_PROPERTIES, ({ name, data }) => {
        switch (name) {
          case 'pause': {
            const isPaused = Boolean(data);
            this._paused = isPaused;
            this.updateCurrentState();
            break;
          }
          case 'paused-for-cache': {
            const isBuffering = Boolean(data);
            this._isBuffering = isBuffering;
            this.updateCurrentState();
            break;
          }
          case 'time-pos': {
            if (typeof data === 'number' && !Number.isNaN(data)) {
              this._currentTime = data;
              if (this._isBuffering) {
                this._isBuffering = false;
                this.updateCurrentState();
              } else if (this._state === 'loading') {
                this.updateCurrentState();
              }
              this.timeUpdateListeners.forEach((cb) => cb(this._currentTime, this._duration));
            }
            break;
          }
          case 'duration': {
            if (typeof data === 'number' && !Number.isNaN(data) && data > 0) {
              this._duration = data;
              this.timeUpdateListeners.forEach((cb) => cb(this._currentTime, this._duration));
            }
            break;
          }
          case 'speed': {
            if (typeof data === 'number') {
              this._playbackRate = data;
            }
            break;
          }
          case 'volume': {
            if (typeof data === 'number') {
              this._volume = data;
            }
            break;
          }
          case 'dwidth': {
            if (typeof data === 'number' && data > 0) {
              this._videoWidth = data;
              if (this._videoHeight > 0) {
                this.videoDimensionsListeners.forEach((cb) => cb(this._videoWidth, this._videoHeight));
              }
            }
            break;
          }
          case 'dheight': {
            if (typeof data === 'number' && data > 0) {
              this._videoHeight = data;
              if (this._videoWidth > 0) {
                this.videoDimensionsListeners.forEach((cb) => cb(this._videoWidth, this._videoHeight));
              }
            }
            break;
          }
          case 'track-list': {
            if (Array.isArray(data)) {
              this.handleTrackList(data);
            }
            break;
          }
        }
      });

      this.unlistenEvents = await listenEvents((ev) => {
        if (ev.event === 'end-file' && (ev as any).reason === 'error') {
          this.setState('idle');
          this.errorListeners.forEach((cb) => cb('libmpv 播放出错或媒体流异常中断'));
        }
      });
    } catch (err) {
      console.warn('[MpvEngine Observe Error]', err);
    }
  }

  private handleTrackList(tracks: any[]) {
    const audio: MappedTrack[] = [];
    const subtitles: MappedTrack[] = [];

    for (const t of tracks) {
      if (t.type === 'audio') {
        audio.push({
          id: String(t.id),
          type: 'audio',
          mpvId: t.id,
          title: t.title || t.lang || `音频音轨 ${t.id}`,
          language: t.lang,
          codec: t.codec,
          isExternal: Boolean(t.external),
          isDefault: Boolean(t.default || t.selected),
          originalIndex: t.id,
        });
      } else if (t.type === 'sub') {
        subtitles.push({
          id: String(t.id),
          type: 'subtitle',
          mpvId: t.id,
          title: t.title || t.lang || `字幕 ${t.id}`,
          language: t.lang,
          codec: t.codec,
          isExternal: Boolean(t.external),
          isDefault: Boolean(t.default || t.selected),
          originalIndex: t.id,
        });
      }
    }

    if (audio.length > 0 || subtitles.length > 0) {
      this.tracksLoadedListeners.forEach((cb) => cb(audio, subtitles));
    }
  }

  private updateCurrentState() {
    if (this._isBuffering) {
      this.setState('buffering');
    } else if (this._paused) {
      this.setState('paused');
    } else {
      this.setState('playing');
    }
  }

  async load(options: PlayerLoadOptions): Promise<void> {
    if (!this.isInitialized) {
      await this.init(null);
    }

    this.setState('loading');
    try {
      await command('loadfile', [options.url]);
      await setProperty('pause', false);
      this._paused = false;

      if (options.initialTime && options.initialTime > 0) {
        await command('seek', [options.initialTime, 'absolute']);
        this._currentTime = options.initialTime;
      }
      this.setState('playing');
    } catch (err: any) {
      console.error('[MpvEngine Load Error]', err);
      this.setState('idle');
      this.errorListeners.forEach((cb) => cb(err?.message || '加载媒体流失败'));
    }
  }

  async play(): Promise<void> {
    try {
      await setProperty('pause', false);
      this._paused = false;
      this.setState('playing');
    } catch (err) {
      console.warn('[MpvEngine Play Error]', err);
    }
  }

  async pause(): Promise<void> {
    try {
      await setProperty('pause', true);
      this._paused = true;
      this.setState('paused');
    } catch (err) {
      console.warn('[MpvEngine Pause Error]', err);
    }
  }

  async togglePlay(): Promise<void> {
    if (this.paused) {
      await this.play();
    } else {
      await this.pause();
    }
  }

  async seek(targetSeconds: number): Promise<void> {
    try {
      await command('seek', [targetSeconds, 'absolute']);
      this._currentTime = targetSeconds;
      this.timeUpdateListeners.forEach((cb) => cb(targetSeconds, this._duration));
    } catch (err) {
      console.warn('[MpvEngine Seek Error]', err);
    }
  }

  async setVolume(volume: number): Promise<void> {
    this._volume = Math.max(0, Math.min(100, volume));
    try {
      await setProperty('volume', this._volume);
    } catch (err) {
      console.warn('[MpvEngine SetVolume Error]', err);
    }
  }

  async setPlaybackRate(rate: number): Promise<void> {
    this._playbackRate = rate;
    try {
      await setProperty('speed', rate);
    } catch (err) {
      console.warn('[MpvEngine SetSpeed Error]', err);
    }
  }

  async selectAudioTrack(trackId: string): Promise<void> {
    try {
      await setProperty('aid', trackId);
    } catch (err) {
      console.warn('[MpvEngine SelectAudioTrack Error]', err);
    }
  }

  async selectSubtitleTrack(trackId: string | null): Promise<void> {
    try {
      await setProperty('sid', trackId ? trackId : 'no');
    } catch (err) {
      console.warn('[MpvEngine SelectSubtitleTrack Error]', err);
    }
  }

  /**
   * 宽银幕底对齐设置
   * mpv 的 video-align-y 属性范围为 -1.0 (顶部) ~ 0.0 (居中) ~ 1.0 (底部)
   * 当 bottomAlign 开启时，verticalOffsetPercent: 50 -> 0.0 (居中), 100 -> 1.0 (完全贴底)
   */
  async setVideoAlignment(verticalOffsetPercent: number, bottomAlign: boolean): Promise<void> {
    try {
      if (!bottomAlign) {
        await setProperty('video-align-y', 0.0);
      } else {
        const alignY = Math.max(0.0, Math.min(1.0, (verticalOffsetPercent - 50) / 50));
        await setProperty('video-align-y', alignY);
      }
    } catch (err) {
      console.warn('[MpvEngine SetVideoAlignment Error]', err);
    }
  }

  async destroy(): Promise<void> {
    if (this.unlisten) {
      try {
        this.unlisten();
      } catch {}
      this.unlisten = null;
    }
    if (this.unlistenEvents) {
      try {
        this.unlistenEvents();
      } catch {}
      this.unlistenEvents = null;
    }
    if (this.isInitialized) {
      try {
        await command('stop');
        await destroy();
      } catch (e) {
        console.warn('[MpvEngine Destroy Error]', e);
      }
      this.isInitialized = false;
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
