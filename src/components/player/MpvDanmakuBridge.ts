import { DanmakuMediaAdapter } from 'danmaku';

/**
 * 120Hz 高刷新率线性插值时钟适配器
 * 将 libmpv 较低频（50ms~200ms）推送的 time-pos 与播放状态，
 * 转换为与显示器刷新率（60/120/144Hz）同步的平滑单调时钟，
 * 彻底消除弹幕微卡顿与跳跃感。
 */
export class MpvDanmakuBridge extends EventTarget implements DanmakuMediaAdapter {
  private _baseTime = 0;
  private _lastSyncPerf = performance.now();
  private _paused = true;
  private _playbackRate = 1.0;
  private _offset = 0; // 弹幕时间偏移（秒），正值代表弹幕提前出现，负值延后

  get currentTime(): number {
    if (this._paused) {
      return Math.max(0, this._baseTime + this._offset);
    }
    const elapsed = ((performance.now() - this._lastSyncPerf) / 1000) * this._playbackRate;
    return Math.max(0, this._baseTime + elapsed + this._offset);
  }

  get paused(): boolean {
    return this._paused;
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  get offset(): number {
    return this._offset;
  }

  set offset(seconds: number) {
    this._offset = seconds;
    // 偏移变化时触发 seeking，让 Danmaku 立即按新时基重新定位弹幕游标
    this.dispatchEvent(new Event('seeking'));
  }

  /**
   * 收到 libmpv 的 time-pos 属性更新通知
   */
  onMpvTimePos(mpvSeconds: number | null) {
    if (mpvSeconds === null || Number.isNaN(mpvSeconds)) return;

    const predictedPureTime = this.currentTime - this._offset;
    const drift = Math.abs(mpvSeconds - predictedPureTime);

    this._baseTime = mpvSeconds;
    this._lastSyncPerf = performance.now();

    // 当时间漂移超过 0.75 秒（用户拖动了进度条或跳转章节），触发 seeking 重置舞台
    if (drift > 0.75) {
      this.dispatchEvent(new Event('seeking'));
    }
  }

  /**
   * 收到 libmpv 的 pause 或 core-idle (网络缓冲等待) 状态变化
   * 关键避坑点 5：只要进入缓冲等待，即刻冻结弹幕
   */
  onMpvPauseChange(isPausedOrBuffering: boolean) {
    if (this._paused === isPausedOrBuffering) return;

    // 冻结前更新当前纯时间基准
    this._baseTime = this.currentTime - this._offset;
    this._lastSyncPerf = performance.now();
    this._paused = isPausedOrBuffering;

    this.dispatchEvent(new Event(isPausedOrBuffering ? 'pause' : 'play'));
  }

  /**
   * 收到 libmpv 的 speed 播放倍速变化
   */
  onMpvSpeedChange(speed: number) {
    if (speed <= 0 || this._playbackRate === speed) return;

    this._baseTime = this.currentTime - this._offset;
    this._lastSyncPerf = performance.now();
    this._playbackRate = speed;

    this.dispatchEvent(new Event('ratechange'));
  }

  /**
   * 销毁重置
   */
  reset() {
    this._baseTime = 0;
    this._paused = true;
    this._playbackRate = 1.0;
    this._offset = 0;
    this._lastSyncPerf = performance.now();
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('seeking'));
  }
}
