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
import { invoke } from '@tauri-apps/api/core';
import {
  BufferConfigOptions,
  HwdecMode,
  IPlayerEngine,
  PlayerLoadOptions,
  PlayerState,
  PlayerTelemetry,
  ResolvedStreamProxyInfo,
  StreamProxyOverride,
  ToneMappingMode,
  VideoAspectPreset,
} from './types';
import { DEFAULT_EMBY_USER_AGENT, MappedTrack } from '../api/embyClient';
import {
  isLoopbackUrl,
  isTauriEnvironment,
  resolveEffectiveProxyDetailed,
  shouldBypassProxy,
} from '../api/http';

const IS_MACOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);
const MPV_EMBED_WINDOW_TITLE = 'Nocta Video Surface';

const OBSERVED_PROPERTIES = [
  ['pause', 'flag'],
  ['time-pos', 'double', 'none'],
  ['duration', 'double', 'none'],
  ['paused-for-cache', 'flag'],
  ['seeking', 'flag', 'none'],
  ['speed', 'double'],
  ['volume', 'double'],
  ['dwidth', 'int64', 'none'],
  ['dheight', 'int64', 'none'],
  ['track-list', 'node', 'none'],
  ['cache-speed', 'int64', 'none'],
  ['demuxer-cache-state', 'node', 'none'],
  // 真实硬件解码状态与缓冲/帧率标量遥测（全部通过事件推送，严禁调用 getProperty(..., 'node')）
  ['hwdec-current', 'string', 'none'],
  ['video-codec', 'string', 'none'],
  ['estimated-vf-fps', 'double', 'none'],
  ['frame-drop-count', 'int64', 'none'],
  ['demuxer-cache-duration', 'double', 'none'],
  ['demuxer-cache-time', 'double', 'none'],
] as const satisfies readonly MpvObservableProperty[];

export async function resolveMpvProxyDetailed(
  targetUrl?: string,
  override: StreamProxyOverride = 'follow'
): Promise<ResolvedStreamProxyInfo> {
  if (override === 'direct') {
    return { mode: 'direct', effectiveProxy: '', overrideMode: 'direct' };
  }

  try {
    const detail = await resolveEffectiveProxyDetailed();

    if (override === 'follow' && Boolean(detail.url) && targetUrl && shouldBypassProxy(targetUrl, detail.bypass)) {
      return { mode: 'lan_bypass', effectiveProxy: '', overrideMode: 'follow' };
    }

    if (!detail.url) {
      return {
        mode: 'direct',
        effectiveProxy: '',
        overrideMode: override,
        notice:
          override === 'proxy' ? '当前未检测到可用系统或手动代理，已回退直连' : undefined,
      };
    }

    const trimmed = detail.url.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return {
        mode: detail.source === 'system' ? 'system_http' : 'manual_http',
        effectiveProxy: trimmed,
        rustProxy: trimmed,
        configuredProxy: trimmed,
        overrideMode: override,
      };
    }

    if (/^socks/i.test(trimmed)) {
      if (isTauriEnvironment()) {
        try {
          const bridgeUrl = await invoke<string>('ensure_socks5_http_bridge', {
            socksUrl: trimmed,
          });
          return {
            mode: 'socks5_bridge',
            effectiveProxy: bridgeUrl,
            rustProxy: trimmed,
            configuredProxy: trimmed,
            overrideMode: override,
          };
        } catch (bridgeErr) {
          console.warn('[MpvEngine SOCKS5 Bridge Fallback]', bridgeErr);
        }
      }

      return {
        mode: 'socks5_fallback_direct',
        effectiveProxy: '',
        rustProxy: trimmed,
        configuredProxy: trimmed,
        overrideMode: override,
        notice:
          'SOCKS5 本地隧道桥接启动失败，libmpv 视频流已自动回退直连；建议使用 HTTP/混合端口（如 7890）或重试',
      };
    }

    return {
      mode: 'direct',
      effectiveProxy: '',
      configuredProxy: trimmed,
      overrideMode: override,
    };
  } catch (e) {
    console.warn('[MpvEngine Resolve Proxy Warning]', e);
    return { mode: 'direct', effectiveProxy: '', overrideMode: override };
  }
}

function formatMpvEndFileError(errorCode?: number, fileError?: string): string {
  switch (errorCode) {
    case -13:
      return '媒体流加载失败 (libmpv error -13)：服务器可能拦截了当前 User-Agent/鉴权头，或直链/网络代理异常';
    case -14:
      return '音频输出初始化失败 (libmpv error -14)';
    case -15:
      return '视频渲染初始化失败 (libmpv error -15)';
    case -16:
      return '无可播放的音视频轨道 (libmpv error -16)';
    case -17:
      return '无法识别的媒体格式 (libmpv error -17)';
    case -18:
      return '不支持的媒体协议或格式 (libmpv error -18)';
    default:
      if (typeof errorCode === 'number') {
        return fileError
          ? `libmpv 播放出错 (${errorCode}): ${fileError}`
          : `libmpv 播放出错 (code ${errorCode})`;
      }
      return fileError ? `libmpv 播放出错: ${fileError}` : 'libmpv 播放出错或媒体流异常中断';
  }
}

function computeMpvBufferProperties(config: BufferConfigOptions) {
  const durationSec = Math.max(60, Math.min(1800, Math.round(config.bufferDurationSeconds || 300)));
  const capMB = Math.max(256, Math.min(4096, Math.round(config.cacheMemoryCapMB || 1024)));
  const capBytes = capMB * 1024 * 1024;
  const bitrateBps =
    config.mediaBitrateBps && config.mediaBitrateBps > 0
      ? config.mediaBitrateBps
      : 16 * 1000 * 1000; // 未提供码率时按 16 Mbps 保底估算
  const estForwardBytes = Math.ceil((bitrateBps / 8) * durationSec * 1.25);
  const maxForwardBytes = Math.max(128 * 1024 * 1024, Math.min(capBytes, estForwardBytes));
  const maxBackBytes = Math.max(
    64 * 1024 * 1024,
    Math.min(256 * 1024 * 1024, Math.round(maxForwardBytes * 0.25))
  );
  return { durationSec, maxForwardBytes, maxBackBytes };
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
  private bufferConfig: BufferConfigOptions = {
    bufferDurationSeconds: 300,
    cacheMemoryCapMB: 1024,
  };
  private loadEpoch = 0;
  private loadfileDispatchedEpoch = 0;
  private awaitingFileLoaded = false;
  private macWindowAttachPromise: Promise<void> | null = null;

  private _state: PlayerState = 'idle';
  private _currentTime = 0;
  private _duration = 0;
  private _volume = 100;
  private _playbackRate = 1.0;
  private _paused = true;
  private _pausedForCache = false;
  private _isSeeking = false;
  private _isSeekBuffering = false;
  private seekBufferTimer: number | null = null;
  private bufferingFreezeTimePos: number | null = null;
  private _videoWidth = 0;
  private _videoHeight = 0;
  private _networkSpeed = 0;
  private lastSpeedUpdateAt = 0;
  private _telemetry: PlayerTelemetry = {};
  private _lastProxyInfo: ResolvedStreamProxyInfo | null = null;
  private telemetryTimer: number | null = null;
  private telemetryDirty = false;

  private timeUpdateListeners: Set<(currentTime: number, duration: number) => void> = new Set();
  private stateChangeListeners: Set<(state: PlayerState) => void> = new Set();
  private errorListeners: Set<(errorMsg: string) => void> = new Set();
  private videoDimensionsListeners: Set<(width: number, height: number) => void> = new Set();
  private tracksLoadedListeners: Set<(audio: MappedTrack[], subtitles: MappedTrack[]) => void> = new Set();
  private networkSpeedListeners: Set<(speed: number) => void> = new Set();
  private telemetryListeners: Set<(telemetry: PlayerTelemetry) => void> = new Set();
  private proxyResolvedListeners: Set<(info: ResolvedStreamProxyInfo) => void> = new Set();
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

      const proxyInfo = await resolveMpvProxyDetailed();
      const effectiveProxy = proxyInfo.effectiveProxy;

      if (!MpvPlayerEngine.mpvInstanceCreated) {
        // initialOptions 仅保留跨平台 100% 兼容的核心参数，避免因个别平台不识别辅助选项导致 mpv_wrapper_create 返回 NULL
        const initialOptions: Record<string, string | boolean | number> = {
          vo: 'gpu-next,gpu',
          hwdec: 'auto-safe',
          'keep-open': 'yes',
          'force-window': 'yes',
        };
        if (IS_MACOS) {
          initialOptions.title = MPV_EMBED_WINDOW_TITLE;
          initialOptions.border = false;
          initialOptions['title-bar'] = false;
          initialOptions['auto-window-resize'] = false;
          initialOptions['focus-on'] = 'never';
          initialOptions['input-cursor-passthrough'] = true;
        }

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
                  ...(IS_MACOS
                    ? {
                        title: MPV_EMBED_WINDOW_TITLE,
                        border: false,
                        'title-bar': false,
                        'auto-window-resize': false,
                        'focus-on': 'never',
                        'input-cursor-passthrough': true,
                      }
                    : {}),
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
      await setProperty('volume-max', 200).catch(() => {});
      await setProperty('screenshot-format', 'png').catch(() => {});
      await setProperty('screenshot-high-bit-depth', 'yes').catch(() => {});
      await setProperty('target-peak', 'auto').catch(() => {});
      await setProperty('user-agent', DEFAULT_EMBY_USER_AGENT).catch(() => {});
      await setProperty('tls-verify', 'no').catch(() => {});
      if (effectiveProxy) {
        await setProperty('http-proxy', effectiveProxy).catch(() => {});
      }

      // 网络流与远端 MKV/MP4 高速 Seek 关键参数配置
      await setProperty('force-seekable', 'yes').catch(() => {});
      await setProperty('cache', 'yes').catch(() => {});
      await setProperty('demuxer-seekable-cache', 'yes').catch(() => {});
      await this.applyBufferConfigToMpv();
      await setProperty('hr-seek', 'default').catch(() => {});
      await setProperty('hr-seek-framedrop', 'yes').catch(() => {}); // 4K 60fps HEVC HDR 跳转避免解码器拥塞黑屏
      await setProperty('demuxer-mkv-subtitle-preroll', 'no').catch(() => {}); // 杜绝 MKV 内嵌字幕反向扫描拖垮网络流
      if (IS_MACOS) {
        await setProperty('title', MPV_EMBED_WINDOW_TITLE).catch(() => {});
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
            if (this._state !== 'loading' && !this.awaitingFileLoaded) {
              this.updateCurrentState();
            }
            break;
          }
          case 'paused-for-cache': {
            this._pausedForCache = Boolean(data);
            this.bufferingFreezeTimePos = this._pausedForCache ? this._currentTime : null;
            if (this._state !== 'loading' && !this.awaitingFileLoaded) {
              this.updateCurrentState();
            }
            break;
          }
          case 'seeking': {
            this._isSeeking = Boolean(data);
            if (this._isSeeking) {
              if (
                this._state !== 'loading' &&
                !this.awaitingFileLoaded &&
                !this._isSeekBuffering &&
                this.seekBufferTimer === null
              ) {
                this.seekBufferTimer = window.setTimeout(() => {
                  this.seekBufferTimer = null;
                  if (
                    !this.isDestroyed &&
                    this._isSeeking &&
                    this._state !== 'loading' &&
                    !this.awaitingFileLoaded
                  ) {
                    this._isSeekBuffering = true;
                    this.updateCurrentState();
                  }
                }, 250);
              }
            } else {
              this.clearSeekBufferTimer();
              this._isSeekBuffering = false;
              if (this._state !== 'loading' && !this.awaitingFileLoaded) {
                this.updateCurrentState();
              }
            }
            break;
          }
          case 'time-pos': {
            if (this.awaitingFileLoaded) {
              break;
            }
            if (typeof data === 'number' && !Number.isNaN(data)) {
              this._currentTime = data;
              if (
                this._pausedForCache &&
                !this._isSeeking &&
                !this._paused &&
                this.bufferingFreezeTimePos !== null &&
                data - this.bufferingFreezeTimePos > 0.15 &&
                data - this.bufferingFreezeTimePos < 3.0
              ) {
                this._pausedForCache = false;
                this.bufferingFreezeTimePos = null;
                if (this._state !== 'loading') {
                  this.updateCurrentState();
                }
              } else if (this._state === 'loading') {
                this.updateCurrentState();
              }
              this.timeUpdateListeners.forEach((cb) => cb(this._currentTime, this._duration));
            }
            break;
          }
          case 'duration': {
            if (this.awaitingFileLoaded) {
              break;
            }
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
              const fwBytes = (data as any)['fw-bytes'];
              if (typeof fwBytes === 'number' && !Number.isNaN(fwBytes) && fwBytes >= 0) {
                this._telemetry.cacheForwardBytes = fwBytes;
                this.emitTelemetryThrottled();
              }
            }
            break;
          }
          case 'hwdec-current': {
            this._telemetry.hwdecCurrent = typeof data === 'string' && data ? data : 'no';
            this.emitTelemetryThrottled();
            break;
          }
          case 'video-codec': {
            if (typeof data === 'string' && data) {
              this._telemetry.videoCodec = data;
              this.emitTelemetryThrottled();
            }
            break;
          }
          case 'estimated-vf-fps': {
            if (typeof data === 'number' && !Number.isNaN(data) && data >= 0) {
              this._telemetry.fps = data;
              this.emitTelemetryThrottled();
            }
            break;
          }
          case 'frame-drop-count': {
            if (typeof data === 'number' && !Number.isNaN(data) && data >= 0) {
              this._telemetry.droppedFrames = data;
              this.emitTelemetryThrottled();
            }
            break;
          }
          case 'demuxer-cache-duration': {
            if (typeof data === 'number' && !Number.isNaN(data) && data >= 0) {
              this._telemetry.cacheDuration = data;
              this.emitTelemetryThrottled();
            }
            break;
          }
          case 'demuxer-cache-time': {
            if (typeof data === 'number' && !Number.isNaN(data) && data >= 0) {
              this._telemetry.bufferedEnd = data;
              this.emitTelemetryThrottled();
            }
            break;
          }
        }
      });

      this.unlistenEvents = await listenEvents(async (ev) => {
        if (this.isDestroyed) return;
        const evName = ev.event;

        if (evName === 'file-loaded') {
          if (this.loadfileDispatchedEpoch !== this.loadEpoch) {
            return;
          }
          this.awaitingFileLoaded = false;
          // 媒体文件头部已成功解析打开
          if (this.pendingSeekTime && this.pendingSeekTime > 0) {
            const targetSeek = this.pendingSeekTime;
            this.pendingSeekTime = null;
            // 媒体文件头打开后执行明确的绝对定点 seek，确保通过 HTTP Range 直达目标片区，
            // 且不会阻断后续播放或向上层抛错
            try {
              await command('seek', [targetSeek, 'absolute']);
            } catch (seekErr) {
              console.warn('[MpvEngine Deferred Seek Warning]', seekErr);
            }
          }
          this.attachMacWindow();
        } else if (evName === 'playback-restart') {
          if (this.loadfileDispatchedEpoch !== this.loadEpoch) {
            return;
          }
          this.awaitingFileLoaded = false;
          // 首帧或定点跳转后音视频解码恢复就绪，重置 start 属性以免影响后续切片
          setProperty('start', 'none').catch(() => {});
          this._pausedForCache = false;
          this._isSeeking = false;
          this._isSeekBuffering = false;
          this.bufferingFreezeTimePos = null;
          this.clearSeekBufferTimer();
          this.updateCurrentState();
          this.timeUpdateListeners.forEach((cb) => cb(this._currentTime, this._duration));
          this.attachMacWindow();
        } else if (evName === 'end-file') {
          const reason = (ev as any).reason;
          if (reason === 'error') {
            if (this.loadfileDispatchedEpoch !== this.loadEpoch) {
              return;
            }
            this.awaitingFileLoaded = false;
            const errorCode =
              typeof (ev as any).error === 'number' ? (ev as any).error : undefined;
            const fileError = (ev as any).file_error;
            console.error('[MpvEngine End-File Error]', ev);
            this.setState('idle');
            const errText = formatMpvEndFileError(errorCode, fileError);
            this.errorListeners.forEach((cb) => cb(errText));
          } else if (reason === 'eof') {
            // 切换新流期间被 replace 中止或处于 awaitingFileLoaded 时忽略旧流的 EOF 事件
            if (!this.awaitingFileLoaded && this.loadfileDispatchedEpoch === this.loadEpoch) {
              this.setState('ended');
            }
          }
        }
      });

      this.startSpeedPolling();
    } catch (err) {
      console.warn('[MpvEngine Observe Error]', err);
    }
  }

  private attachMacWindow() {
    if (!IS_MACOS || this.isDestroyed || this.macWindowAttachPromise) return;

    const epoch = this.loadEpoch;
    this.macWindowAttachPromise = (async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (this.isDestroyed || epoch !== this.loadEpoch) return;
        try {
          if (await invoke<boolean>('attach_mpv_window')) return;
        } catch (err) {
          console.warn('[MpvEngine Attach Window Warning]', err);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      if (!this.isDestroyed && epoch === this.loadEpoch) {
        console.warn('[MpvEngine] macOS mpv 窗口嵌入超时，未找到 Nocta Video Surface 窗口');
      }
    })().finally(() => {
      this.macWindowAttachPromise = null;
    });
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

  private clearSeekBufferTimer() {
    if (this.seekBufferTimer !== null) {
      window.clearTimeout(this.seekBufferTimer);
      this.seekBufferTimer = null;
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
    if (this._isSeekBuffering) {
      this.setState('buffering');
    } else if (this._paused) {
      this.setState('paused');
    } else if (this._pausedForCache) {
      this.setState('buffering');
    } else {
      this.setState('playing');
    }
  }

  async load(options: PlayerLoadOptions): Promise<void> {
    if (this.isDestroyed) return;
    const currentEpoch = ++this.loadEpoch;
    // 在异步探测代理/初始化之前即刻置位，彻底阻断旧流遗留的 time-pos/end-file 污染新剧集状态
    this.awaitingFileLoaded = true;
    this._currentTime = 0;
    this._duration = 0;
    this.setState('loading');

    try {
      if (!this.isInitialized) {
        await this.init(null);
      }
    } catch (initErr: any) {
      if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;
      this.awaitingFileLoaded = false;
      this.setState('idle');
      this.errorListeners.forEach((cb) => cb(initErr?.message || '初始化 libmpv 失败'));
      return;
    }

    if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;

    if (options.bufferConfig) {
      this.bufferConfig = { ...options.bufferConfig };
    }
    await this.applyBufferConfigToMpv();

    // 解析并应用播放流网络代理路线，并向 UI 广播透明代理诊断状态
    let resolvedProxyInfo: ResolvedStreamProxyInfo = {
      mode: 'direct',
      effectiveProxy: '',
      overrideMode: options.proxyOverride ?? 'follow',
    };
    let mpvEffectiveProxy = '';
    try {
      const proxyTargetUrl = options.upstreamUrl || options.url;
      resolvedProxyInfo = await resolveMpvProxyDetailed(
        proxyTargetUrl,
        options.proxyOverride ?? 'follow'
      );
      const isInternalLocalRelay = Boolean(options.upstreamUrl && isLoopbackUrl(options.url));
      mpvEffectiveProxy = isInternalLocalRelay ? '' : resolvedProxyInfo.effectiveProxy;
      this._lastProxyInfo = resolvedProxyInfo;
      this.proxyResolvedListeners.forEach((cb) => cb(resolvedProxyInfo));
      await setProperty('http-proxy', mpvEffectiveProxy);
    } catch (e) {
      console.warn('[MpvEngine Sync Proxy Warning]', e);
    }

    // 重置流级别遥测数据（保留硬解器名称，待新流事件刷新）
    this._telemetry = {
      hwdecCurrent: this._telemetry.hwdecCurrent,
      droppedFrames: 0,
      cacheDuration: 0,
      bufferedEnd: 0,
      cacheForwardBytes: 0,
    };
    this.emitTelemetryThrottled();

    // 每次加载媒体流时，显式保证流可定点 Seek、范围检索 (HTTP Range) 与解码器跳转丢帧保护
    await setProperty('force-seekable', 'yes').catch(() => {});
    await setProperty('hr-seek-framedrop', 'yes').catch(() => {});
    await setProperty('demuxer-mkv-subtitle-preroll', 'no').catch(() => {});
    await this.applyNetworkHeadersToMpv(options.userAgent, options.headers);

    this._pausedForCache = false;
    this._isSeeking = false;
    this._isSeekBuffering = false;
    this.bufferingFreezeTimePos = null;
    this.clearSeekBufferTimer();
    this.setState('loading');
    this.pendingSeekTime = options.initialTime && options.initialTime > 0 ? options.initialTime : null;
    this._currentTime = 0;
    this._duration = 0;

    try {
      // 关键修复：切勿在 loadfile 后同步调用 command('seek')，因为文件尚未完成 demux 打开，
      // 同步调用 seek 会直接抛出 "mpv command failed: error running command" 导致误判流失败！
      // 正确做法：通过 mpv 原生 start 属性预设起播秒数，并在 file-loaded 事件中安全兜底定位。
      if (this.pendingSeekTime && this.pendingSeekTime > 0) {
        await setProperty('start', `+${Math.floor(this.pendingSeekTime)}`).catch(() => {});
      } else {
        await setProperty('start', 'none').catch(() => {});
      }

      if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;
      this.loadfileDispatchedEpoch = currentEpoch;

      try {
        await command('loadfile', [options.url, 'replace']);
      } catch (loadErr: any) {
        const errMsg = String(loadErr?.message || loadErr || '');
        if (errMsg.toLowerCase().includes('not found')) {
          console.warn('[MpvEngine] mpv instance lost, re-initializing and retrying loadfile...');
          this.isInitialized = false;
          MpvPlayerEngine.mpvInstanceCreated = false;
          await this.init(null);
          await this.applyBufferConfigToMpv();
          await setProperty('http-proxy', mpvEffectiveProxy).catch(() => {});
          await this.applyNetworkHeadersToMpv(options.userAgent, options.headers);
          if (this.pendingSeekTime && this.pendingSeekTime > 0) {
            await setProperty('start', `+${Math.floor(this.pendingSeekTime)}`).catch(() => {});
          }
          if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;
          this.loadfileDispatchedEpoch = currentEpoch;
          await command('loadfile', [options.url, 'replace']);
        } else {
          throw loadErr;
        }
      }
      this.attachMacWindow();

      if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;

      await setProperty('pause', false);
      this._paused = false;
    } catch (err: any) {
      if (this.isDestroyed || currentEpoch !== this.loadEpoch) return;
      this.awaitingFileLoaded = false;
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
      this.updateCurrentState();
    } catch (err) {
      console.warn('[MpvEngine Play Error]', err);
    }
  }

  async pause(): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      await setProperty('pause', true);
      this._paused = true;
      this.updateCurrentState();
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
      if (this._pausedForCache) {
        this.bufferingFreezeTimePos = targetSeconds;
      }
      this.timeUpdateListeners.forEach((cb) => cb(targetSeconds, this._duration));
    } catch (err) {
      console.warn('[MpvEngine Seek Error]', err);
    }
  }

  async setVolume(volume: number): Promise<void> {
    this._volume = Math.max(0, Math.min(200, volume));
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

  // ==================== Pro 硬解 / 画质 / 音字幕调校接口 ====================

  private async applyNetworkHeadersToMpv(
    userAgent?: string,
    headers?: Record<string, string>
  ): Promise<void> {
    let effectiveUa = (userAgent || DEFAULT_EMBY_USER_AGENT).trim() || DEFAULT_EMBY_USER_AGENT;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (k.trim().toLowerCase() === 'user-agent' && v && v.trim()) {
          effectiveUa = v.trim();
        }
      }
    }

    await setProperty('user-agent', effectiveUa).catch((e) =>
      console.warn('[MpvEngine Set UA Warning]', e)
    );

    // 必须使用 change-list clr + append 逐条注入请求头：X-Emby-Authorization 内含逗号，
    // 若直接 setProperty('http-header-fields', ...) 会被 mpv 按逗号拆分成多个非法头导致 HTTP 400
    await command('change-list', ['http-header-fields', 'clr', '']).catch(() =>
      setProperty('http-header-fields', '').catch(() => {})
    );

    if (headers) {
      for (const [rawKey, rawVal] of Object.entries(headers)) {
        const key = rawKey.trim();
        const val = rawVal?.trim();
        if (!key || !val || key.toLowerCase() === 'user-agent') continue;
        await command('change-list', ['http-header-fields', 'append', `${key}: ${val}`]).catch(
          (e) => console.warn('[MpvEngine Set Header Warning]', key, e)
        );
      }
    }
  }

  private async applyBufferConfigToMpv(): Promise<void> {
    const { durationSec, maxForwardBytes, maxBackBytes } = computeMpvBufferProperties(
      this.bufferConfig
    );
    await setProperty('demuxer-max-bytes', String(maxForwardBytes)).catch(() => {});
    await setProperty('demuxer-max-back-bytes', String(maxBackBytes)).catch(() => {});
    await setProperty('demuxer-readahead-secs', durationSec).catch(() => {});
  }

  async setBufferConfig(config: BufferConfigOptions): Promise<void> {
    this.bufferConfig = { ...config };
    if (!this.isInitialized || this.isDestroyed) return;
    await this.applyBufferConfigToMpv();
  }

  async setHwdecMode(mode: HwdecMode): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    await setProperty('hwdec', mode).catch(() => {});
  }

  async setVideoAspect(preset: VideoAspectPreset): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    if (preset === 'fill') {
      await setProperty('video-aspect-override', '-1').catch(() => {});
      await setProperty('panscan', 1.0).catch(() => {});
    } else if (preset === 'auto') {
      await setProperty('video-aspect-override', '-1').catch(() => {});
      await setProperty('panscan', 0.0).catch(() => {});
    } else {
      await setProperty('video-aspect-override', preset).catch(() => {});
      await setProperty('panscan', 0.0).catch(() => {});
    }
  }

  async setVideoEnhancement(opts: {
    toneMapping?: ToneMappingMode;
    deband?: boolean;
    brightness?: number;
    contrast?: number;
    saturation?: number;
    gamma?: number;
  }): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    if (opts.toneMapping !== undefined) {
      await setProperty('tone-mapping', opts.toneMapping).catch(() => {});
    }
    if (opts.deband !== undefined) {
      await setProperty('deband', opts.deband ? 'yes' : 'no').catch(() => {});
    }
    if (opts.brightness !== undefined) {
      await setProperty('brightness', opts.brightness).catch(() => {});
    }
    if (opts.contrast !== undefined) {
      await setProperty('contrast', opts.contrast).catch(() => {});
    }
    if (opts.saturation !== undefined) {
      await setProperty('saturation', opts.saturation).catch(() => {});
    }
    if (opts.gamma !== undefined) {
      await setProperty('gamma', opts.gamma).catch(() => {});
    }
  }

  async setAudioEnhancement(opts: {
    audioDelay?: number;
    nightMode?: boolean;
    volumeMax?: number;
  }): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    if (opts.volumeMax !== undefined) {
      await setProperty('volume-max', opts.volumeMax).catch(() => {});
    }
    if (opts.audioDelay !== undefined) {
      await setProperty('audio-delay', opts.audioDelay).catch(() => {});
    }
    if (opts.nightMode !== undefined) {
      await setProperty('af', opts.nightMode ? 'lavfi=[dynaudnorm=f=150:g=15]' : '').catch(() => {});
    }
  }

  async setSubtitleStyle(opts: { delay?: number; scale?: number; pos?: number }): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    if (opts.delay !== undefined) {
      await setProperty('sub-delay', opts.delay).catch(() => {});
    }
    if (opts.scale !== undefined) {
      await setProperty('sub-scale', opts.scale).catch(() => {});
    }
    if (opts.pos !== undefined) {
      await setProperty('sub-pos', opts.pos).catch(() => {});
    }
  }

  async selectSecondarySubtitleTrack(trackId: string | null): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      if (!trackId) {
        await setProperty('secondary-sid', 'no');
        return;
      }
      const numericMatch = String(trackId).match(/(\d+)/);
      const sidValue = numericMatch ? Number(numericMatch[1]) : trackId;
      await setProperty('secondary-sid', sidValue);
    } catch (err) {
      console.warn('[MpvEngine SelectSecondarySubtitleTrack Error]', err);
    }
  }

  async addExternalSubtitle(pathOrUrl: string): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    await command('sub-add', [pathOrUrl, 'select']);
  }

  async frameStep(direction: 'forward' | 'backward'): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    try {
      await command(direction === 'forward' ? 'frame-step' : 'frame-back-step');
    } catch (err) {
      console.warn('[MpvEngine FrameStep Error]', err);
    }
  }

  async setAbLoop(point: 'a' | 'b' | 'clear', seconds?: number): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    if (point === 'clear') {
      await setProperty('ab-loop-a', 'no').catch(() => {});
      await setProperty('ab-loop-b', 'no').catch(() => {});
      return;
    }
    const target = seconds ?? this._currentTime;
    await setProperty(point === 'a' ? 'ab-loop-a' : 'ab-loop-b', target).catch(() => {});
  }

  async takeScreenshot(directory: string, mode: 'subtitles' | 'video' = 'subtitles'): Promise<void> {
    if (!this.isInitialized || this.isDestroyed) return;
    await setProperty('screenshot-directory', directory).catch(() => {});
    await command('screenshot', [mode]);
  }

  private emitTelemetryThrottled() {
    this.telemetryDirty = true;
    if (this.telemetryTimer !== null) return;
    this.telemetryTimer = window.setTimeout(() => {
      this.telemetryTimer = null;
      if (this.isDestroyed || !this.telemetryDirty) return;
      this.telemetryDirty = false;
      const snapshot = { ...this._telemetry };
      this.telemetryListeners.forEach((cb) => cb(snapshot));
    }, 400);
  }

  async destroy(): Promise<void> {
    this.isDestroyed = true;
    this.loadEpoch++;
    if (IS_MACOS) {
      invoke('detach_mpv_window').catch(() => {});
    }

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
    if (this.telemetryTimer !== null) {
      window.clearTimeout(this.telemetryTimer);
      this.telemetryTimer = null;
    }

    this.stopSpeedPolling();
    this.clearSeekBufferTimer();
    this._pausedForCache = false;
    this._isSeeking = false;
    this._isSeekBuffering = false;
    this.bufferingFreezeTimePos = null;
    this.timeUpdateListeners.clear();
    this.stateChangeListeners.clear();
    this.errorListeners.clear();
    this.videoDimensionsListeners.clear();
    this.tracksLoadedListeners.clear();
    this.networkSpeedListeners.clear();
    this.telemetryListeners.clear();
    this.proxyResolvedListeners.clear();
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

  onTelemetry(cb: (telemetry: PlayerTelemetry) => void): () => void {
    this.telemetryListeners.add(cb);
    if (Object.keys(this._telemetry).length > 0) {
      cb({ ...this._telemetry });
    }
    return () => this.telemetryListeners.delete(cb);
  }

  onProxyResolved(cb: (info: ResolvedStreamProxyInfo) => void): () => void {
    this.proxyResolvedListeners.add(cb);
    if (this._lastProxyInfo) {
      cb(this._lastProxyInfo);
    }
    return () => this.proxyResolvedListeners.delete(cb);
  }
}
