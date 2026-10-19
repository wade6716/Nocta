import {
  init,
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
import { resolveEffectiveProxy } from '../api/http';

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
  ['cache-speed', 'int64', 'none'],
  ['demuxer-cache-state', 'node', 'none'],
] as const satisfies readonly MpvObservableProperty[];

function isLanOrLoopbackUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.lan')
    ) {
      return true;
    }
    if (/^10\./.test(host) || /^192\.168\./.test(host)) {
      return true;
    }
    const match172 = host.match(/^172\.(\d+)\./);
    if (match172) {
      const secondOctet = Number(match172[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function resolveMpvHttpProxy(targetUrl?: string): Promise<string> {
  if (targetUrl && isLanOrLoopbackUrl(targetUrl)) {
    return '';
  }
  try {
    const proxy = await resolveEffectiveProxy();
    if (!proxy) return '';
    // libmpv 的 http-proxy 仅支持 http:// 或 https:// 协议代理
    if (/^https?:\/\//i.test(proxy.trim())) {
      return proxy.trim();
    }
    return '';
  } catch (e) {
    console.warn('[MpvEngine Resolve Proxy Warning]', e);
    return '';
  }
}

export class MpvPlayerEngine implements IPlayerEngine {
  // 全局串行队列：防止跨页面停止旧播放与初始化新实例在底层 'main' 窗口发生并发冲突
  private static lifecycleQueue: Promise<void> = Promise.resolve();
  // 进程级 'main' 窗口 mpv 实例存活标记：避免调用 tauri-plugin-libmpv 的 destroy() 触发底层 event_userdata Use-After-Free
  private static mpvInstanceCreated = false;

  private unlisten: UnlistenFn | null = null;
  private unlistenEvents: UnlistenFn | null = null;
  private isInitialized = false;
  private isDestroyed = false;
  private initPromise: Promise<void> | null = null;
  private pendingSeekTime: number | null = null;
  private pendingAlignment: { verticalOffsetPercent: number; bottomAlign: boolean } | null = null;
  private loadEpoch = 0;

  private _state: PlayerState = 'idle';
  private _currentTime = 0;
  private _duration = 0;
  private _volume = 100;
  private _playbackRate = 1.0;
  private _paused = true;
  private _isBuffering = false;
  private _videoWidth = 0;
  private _videoHeight = 0;
  private _networkSpeed = 0;
  private lastSpeedUpdateAt = 0;

  private timeUpdateListeners: Set<(currentTime: number, duration: number) => void> = new Set();
  private stateChangeListeners: Set<(state: PlayerState) => void> = new Set();
  private errorListeners: Set<(errorMsg: string) => void> = new Set();
  private videoDimensionsListeners: Set<(width: number, height: number) => void> = new Set();
  private tracksLoadedListeners: Set<(audio: MappedTrack[], subtitles: MappedTrack[]) => void> = new Set();
  private networkSpeedListeners: Set<(speed: number) => void> = new Set();
  private speedPollTimer: number | null = null;

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
    if (this.initPromise) return this.initPromise;

    const task = MpvPlayerEngine.lifecycleQueue.then(async () => {
      if (this.isDestroyed || this.isInitialized) return;

      const effectiveProxy = await resolveMpvHttpProxy();

      if (!MpvPlayerEngine.mpvInstanceCreated) {
        // initialOptions 仅保留跨平台 100% 兼容的核心参数，避免因个别平台不识别辅助选项导致 mpv_wrapper_create 返回 NULL
        const initialOptions: Record<string, string | boolean | number> = {
          vo: 'gpu-next,gpu',
          hwdec: 'auto-safe',
          'keep-open': 'yes',
          'force-window': 'yes',
        };

        const mpvConfig: MpvConfig = {
          initialOptions,
          observedProperties: OBSERVED_PROPERTIES,
        };

        try {
          await init(mpvConfig);
          MpvPlayerEngine.mpvInstanceCreated = true;
        } catch (err: any) {
          const msg = String(err?.message || err || '');
          if (msg.toLowerCase().includes('already exists')) {
            MpvPlayerEngine.mpvInstanceCreated = true;
          } else {
            // 若因特定平台显卡驱动不接受 vo=gpu-next,gpu 导致创建失败，使用极简兼容参数重试一次
            try {
              await init({
                initialOptions: {
                  'keep-open': 'yes',
                  'force-window': 'yes',
                },
                observedProperties: OBSERVED_PROPERTIES,
              });
              MpvPlayerEngine.mpvInstanceCreated = true;
            } catch (retryErr: any) {
              const retryMsg = String(retryErr?.message || retryErr || '');
              if (retryMsg.toLowerCase().includes('already exists')) {
                MpvPlayerEngine.mpvInstanceCreated = true;
              } else {
                console.error('[MpvEngine Init Error]', err);
                throw new Error(`初始化 libmpv 原生内核失败: ${msg}`);
              }
            }
          }
        }
      }

      if (this.isDestroyed) {
        await command('stop').catch(() => {});
        return;
      }

      // 辅助运行参数在实例就绪后通过 setProperty 安全注入，即使单个属性在特定平台不支持也不会阻断内核启动
      await setProperty('osc', 'no').catch(() => {});
      await setProperty('osd-level', 0).catch(() => {});
      await setProperty('input-default-bindings', 'no').catch(() => {});
      await setProperty('input-vo-keyboard', 'no').catch(() => {});
      await setProperty('panscan', 0.0).catch(() => {});
      if (effectiveProxy) {
        await setProperty('http-proxy', effectiveProxy).catch(() => {});
      }

      this.isInitialized = true;
      await this.bindMpvEvents();

      if (this.pendingAlignment) {
        const { verticalOffsetPercent, bottomAlign } = this.pendingAlignment;
        await this.applyVideoAlignment(verticalOffsetPercent, bottomAlign);
      }
    });

    // 确保队列本身不会因异常中断后续生命周期任务
    MpvPlayerEngine.lifecycleQueue = task.catch(() => {});
    this.initPromise = task;

    try {
      await task;
    } finally {
      this.initPromise = null;
    }
  }

  private async bindMpvEvents() {
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

    try {
      this.unlisten = await observeProperties(OBSERVED_PROPERTIES, ({ name, data }) => {
        if (this.isDestroyed) return;
        switch (name) {
          case 'pause': {
            const isPaused = Boolean(data);
            this._paused = isPaused;
            if (this._state !== 'loading') {
              this.updateCurrentState();
            }
            break;
          }
          case 'paused-for-cache': {
            const isBuffering = Boolean(data);
            this._isBuffering = isBuffering;
            if (this._state !== 'loading') {
              this.updateCurrentState();
            }
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
          case 'cache-speed': {
            if (typeof data === 'number' && !Number.isNaN(data) && data >= 0) {
              this.lastSpeedUpdateAt = Date.now();
              if (this._networkSpeed !== data) {
                this._networkSpeed = data;
                this.networkSpeedListeners.forEach((cb) => cb(this._networkSpeed));
              }
            }
            break;
          }
          case 'demuxer-cache-state': {
            if (data && typeof data === 'object') {
              const rawRate = (data as any)['raw-input-rate'];
              if (typeof rawRate === 'number' && !Number.isNaN(rawRate) && rawRate >= 0) {
                this.lastSpeedUpdateAt = Date.now();
                if (this._networkSpeed !== rawRate) {
                  this._networkSpeed = rawRate;
                  this.networkSpeedListeners.forEach((cb) => cb(this._networkSpeed));
                }
              }
            }
            break;
          }
        }
      });

      this.unlistenEvents = await listenEvents(async (ev) => {
        if (this.isDestroyed) return;
        const evName = ev.event;

        if (evName === 'file-loaded') {
          // 媒体文件头部已成功加载，重置 start 属性以免影响后续播放
          setProperty('start', 'none').catch(() => {});
          this._isBuffering = false;
          this.updateCurrentState();

          if (this.pendingSeekTime && this.pendingSeekTime > 0) {
            const targetSeek = this.pendingSeekTime;
            this.pendingSeekTime = null;
            // 若 start 属性未生效或偏差超过 3 秒，在 file-loaded 后安全执行一次兜底 seek
            if (Math.abs(this._currentTime - targetSeek) > 3) {
              try {
                await command('seek', [targetSeek, 'absolute']);
                this._currentTime = targetSeek;
                this.timeUpdateListeners.forEach((cb) => cb(targetSeek, this._duration));
              } catch (seekErr) {
                console.warn('[MpvEngine Deferred Seek Warning]', seekErr);
              }
            }
          }
        } else if (evName === 'playback-restart') {
          // 首帧或跳转后音视频解码恢复就绪
          this._isBuffering = false;
          this.updateCurrentState();
          this.timeUpdateListeners.forEach((cb) => cb(this._currentTime, this._duration));
        } else if (evName === 'end-file') {
          const reason = (ev as any).reason;
          if (reason === 'error') {
            const fileError = (ev as any).file_error;
            console.error('[MpvEngine End-File Error]', ev);
            this.setState('idle');
            this.errorListeners.forEach((cb) =>
              cb(fileError ? `libmpv 播放出错: ${fileError}` : 'libmpv 播放出错或媒体流异常中断')
            );
          } else if (reason === 'eof') {
            this.setState('ended');
          }
        }
      });

      this.startSpeedPolling();
    } catch (err) {
      console.warn('[MpvEngine Observe Error]', err);
    }
  }

  /**
   * 重要避坑：绝对禁止调用 getProperty(..., 'node')！
   * nini22P/libmpv-wrapper 的 get_property_node 在栈上仅分配 8 字节指针 (*mut mpv_node)，
   * 而 libmpv 的 mpv_get_property(..., MPV_FORMAT_NODE) 会直接向该地址写入 16 字节的 mpv_node 结构体并触发非法释放，
   * 导致 Windows/macOS 下 100% 发生栈缓冲区溢出崩溃 (STATUS_ACCESS_VIOLATION / CrashSender.exe)。
   * 因此实时网速完全通过 observeProperties 事件推送获取，此处仅用纯 JS 定时器做闲置归零衰减。
   */
  private startSpeedPolling() {
    if (this.speedPollTimer !== null) return;
    this.speedPollTimer = window.setInterval(() => {
      if (!this.isInitialized || this.isDestroyed || this._state === 'idle' || this._state === 'ended') {
        if (this._networkSpeed !== 0) {
          this._networkSpeed = 0;
          this.networkSpeedListeners.forEach((cb) => cb(0));
        }
        return;
      }
      // 当缓冲填满暂停拉流、超过 2.5 秒未收到新的速率更新事件时，自动平滑归零
      if (this._networkSpeed > 0 && Date.now() - this.lastSpeedUpdateAt > 2500) {
        this._networkSpeed = 0;
        this.networkSpeedListeners.forEach((cb) => cb(0));
      }
    }, 1000);
  }

  private stopSpeedPolling() {
    if (this.speedPollTimer !== null) {
      window.clearInterval(this.speedPollTimer);
      this.speedPollTimer = null;
    }
  }

  private handleTrackList(tracks: any[]) {
    const audio: MappedTrack[] = [];
    const subtitles: MappedTrack[] = [];

    for (const t of tracks) {
      if (t.type === 'audio') {
        audio.push({
          id: `audio-${t.id}`,
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
          id: `sub-${t.id}`,
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
    if (this.isDestroyed) return;
    const currentEpoch = ++this.loadEpoch;

    try {
      if (!this.isInitialized) {
        await this.init(null);
      }
    } catch (initErr: any) {
      if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;
      this.setState('idle');
      this.errorListeners.forEach((cb) => cb(initErr?.message || '初始化 libmpv 失败'));
      return;
    }

    if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;

    // 根据目标 URL 是否为局域网动态设置代理
    try {
      const effectiveProxy = await resolveMpvHttpProxy(options.url);
      await setProperty('http-proxy', effectiveProxy);
    } catch (e) {
      console.warn('[MpvEngine Sync Proxy Warning]', e);
    }

    this.setState('loading');
    this.pendingSeekTime = options.initialTime && options.initialTime > 0 ? options.initialTime : null;

    try {
      // 关键修复：切勿在 loadfile 后同步调用 command('seek')，因为文件尚未完成 demux 打开，
      // 同步调用 seek 会直接抛出 "mpv command failed: error running command" 导致误判流失败！
      // 正确做法：通过 mpv 原生 start 属性预设起播秒数，并在 file-loaded 事件中做兜底校验。
      if (this.pendingSeekTime && this.pendingSeekTime > 0) {
        await setProperty('start', `+${Math.floor(this.pendingSeekTime)}`);
        this._currentTime = this.pendingSeekTime;
      } else {
        await setProperty('start', 'none').catch(() => {});
        this._currentTime = 0;
      }

      try {
        await command('loadfile', [options.url, 'replace']);
      } catch (loadErr: any) {
        const errMsg = String(loadErr?.message || loadErr || '');
        if (errMsg.toLowerCase().includes('not found')) {
          console.warn('[MpvEngine] mpv instance lost, re-initializing and retrying loadfile...');
          this.isInitialized = false;
          MpvPlayerEngine.mpvInstanceCreated = false;
          await this.init(null);
          if (this.pendingSeekTime && this.pendingSeekTime > 0) {
            await setProperty('start', `+${Math.floor(this.pendingSeekTime)}`).catch(() => {});
          }
          await command('loadfile', [options.url, 'replace']);
        } else {
          throw loadErr;
        }
      }

      if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;

      await setProperty('pause', false);
      this._paused = false;
    } catch (err: any) {
      if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;
      console.error('[MpvEngine Load Error]', err);
      this.setState('idle');
      this.errorListeners.forEach((cb) => cb(err?.message || String(err) || '加载媒体流失败'));
    }
  }

  async play(): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      await setProperty('pause', false);
      this._paused = false;
      this.setState('playing');
    } catch (err) {
      console.warn('[MpvEngine Play Error]', err);
    }
  }

  async pause(): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
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
    if (!this.isInitialized || this.isDestroyed) return;
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
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      await setProperty('volume', this._volume);
    } catch (err) {
      console.warn('[MpvEngine SetVolume Error]', err);
    }
  }

  async setPlaybackRate(rate: number): Promise<void> {
    this._playbackRate = rate;
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      await setProperty('speed', rate);
    } catch (err) {
      console.warn('[MpvEngine SetSpeed Error]', err);
    }
  }

  async selectAudioTrack(trackId: string): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      const numericMatch = String(trackId).match(/(\d+)/);
      const aidValue = numericMatch ? Number(numericMatch[1]) : trackId;
      await setProperty('aid', aidValue);
    } catch (err) {
      console.warn('[MpvEngine SelectAudioTrack Error]', err);
    }
  }

  async selectSubtitleTrack(trackId: string | null): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      if (!trackId) {
        await setProperty('sid', 'no');
        return;
      }
      if (/^https?:\/\//i.test(trackId)) {
        await command('sub-add', [trackId, 'select']);
        return;
      }
      const numericMatch = String(trackId).match(/(\d+)/);
      const sidValue = numericMatch ? Number(numericMatch[1]) : trackId;
      await setProperty('sid', sidValue);
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
    this.pendingAlignment = { verticalOffsetPercent, bottomAlign };
    if (!this.isInitialized || this.isDestroyed) return;
    await this.applyVideoAlignment(verticalOffsetPercent, bottomAlign);
  }

  private async applyVideoAlignment(verticalOffsetPercent: number, bottomAlign: boolean): Promise<void> {
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
    this.isDestroyed = true;
    this.loadEpoch++;

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

    this.stopSpeedPolling();
    this.timeUpdateListeners.clear();
    this.stateChangeListeners.clear();
    this.errorListeners.clear();
    this.videoDimensionsListeners.clear();
    this.tracksLoadedListeners.clear();
    this.networkSpeedListeners.clear();
    this._networkSpeed = 0;
    this._state = 'idle';

    const task = MpvPlayerEngine.lifecycleQueue.then(async () => {
      if (this.isInitialized) {
        this.isInitialized = false;
        try {
          // 仅停止当前播放流并进入空闲状态，不调用 tauri-plugin-libmpv 的 destroy()，
          // 规避插件底层销毁时释放 event_userdata 与后台事件线程产生 Use-After-Free 崩溃。
          await setProperty('pause', true).catch(() => {});
          await command('stop').catch(() => {});
        } catch (e) {
          console.warn('[MpvEngine Stop Error]', e);
        }
      }
    });

    MpvPlayerEngine.lifecycleQueue = task.catch(() => {});
    await MpvPlayerEngine.lifecycleQueue;
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
    cb(this._networkSpeed);
    return () => this.networkSpeedListeners.delete(cb);
  }
}
