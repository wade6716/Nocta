use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
use tauri::{AppHandle, Emitter, Manager};

pub const MEDIA_CONTROL_EVENT: &str = "media://control";
pub const AUDIO_OUTPUT_CHANGED_EVENT: &str = "media://audio-output-changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaControlPayload {
    pub action: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputChangedPayload {
    pub reason: String,
    pub should_pause: bool,
    pub previous_device_name: Option<String>,
    pub current_device_name: Option<String>,
}

#[derive(Default)]
pub struct MediaSessionState {
    controls: Mutex<Option<MediaControls>>,
}

/// 判断设备名是否属于耳机或蓝牙音频设备
pub fn is_headphone_or_bluetooth_name(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    const KEYWORDS: &[&str] = &[
        "headphone",
        "headset",
        "earphone",
        "earbud",
        "airpods",
        "beats",
        "buds",
        "pods",
        "bluetooth",
        "hands-free",
        "bose",
        "wh-1000",
        "wf-1000",
        "freebuds",
        "encofree",
        "耳机",
        "头戴",
        "蓝牙",
    ];
    KEYWORDS.iter().any(|kw| lower.contains(kw))
}

/// 判断设备名是否属于外放扬声器或显示器内置音频
pub fn is_speaker_or_builtin_name(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    const KEYWORDS: &[&str] = &[
        "speaker",
        "built-in",
        "internal",
        "realtek",
        "monitor",
        "display audio",
        "hdmi",
        "displayport",
        "扬声器",
        "内置",
        "外放",
    ];
    KEYWORDS.iter().any(|kw| lower.contains(kw))
}

/// 判断音频输出路由切换时是否应当自动暂停播放：
/// 1. 原默认输出设备已断开/拔出/不可用（蓝牙放回充电盒、关机、拔出 3.5mm/USB 耳机）→ 必定暂停；
/// 2. 原设备为耳机/蓝牙且切换至扬声器/外放设备 → 暂停以防外放尴尬；
/// 3. 从扬声器切换至新连接的耳机（例如戴上蓝牙耳机）→ 不暂停，保持无缝观影。
pub fn should_pause_on_audio_route_change(
    previous_removed: bool,
    previous_was_headphone: bool,
    previous_name: Option<&str>,
    current_name: Option<&str>,
) -> bool {
    if previous_removed {
        return true;
    }

    let prev_is_hp = previous_was_headphone
        || previous_name
            .map(is_headphone_or_bluetooth_name)
            .unwrap_or(false);
    let curr_is_hp = current_name
        .map(is_headphone_or_bluetooth_name)
        .unwrap_or(false);
    let curr_is_speaker = current_name
        .map(is_speaker_or_builtin_name)
        .unwrap_or(false);

    prev_is_hp && !curr_is_hp && (curr_is_speaker || current_name.is_none())
}

/// 初始化系统级媒体会话（Windows SMTC / macOS Now Playing / Linux MPRIS2），
/// 用于接收蓝牙耳机入耳检测（AVRCP Pause/Play）与系统多媒体按键事件
pub fn init_media_session(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    let hwnd = app
        .get_webview_window("main")
        .and_then(|win| win.hwnd().ok())
        .map(|h| h.0 as *mut std::ffi::c_void);

    #[cfg(not(target_os = "windows"))]
    let hwnd: Option<*mut std::ffi::c_void> = None;

    let config = PlatformConfig {
        dbus_name: "nocta",
        display_name: "Nocta · 夜幕",
        hwnd,
    };

    let mut controls = match MediaControls::new(config) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[Nocta MediaSession] 初始化系统媒体控制失败（将优雅降级）: {e:?}");
            return;
        }
    };

    let app_handle = app.clone();
    if let Err(e) = controls.attach(move |event: MediaControlEvent| {
        let action = match event {
            MediaControlEvent::Play => Some("play"),
            MediaControlEvent::Pause => Some("pause"),
            MediaControlEvent::Toggle => Some("toggle"),
            MediaControlEvent::Stop => Some("stop"),
            MediaControlEvent::Next => Some("next"),
            MediaControlEvent::Previous => Some("previous"),
            _ => None,
        };
        if let Some(act) = action {
            let _ = app_handle.emit(
                MEDIA_CONTROL_EVENT,
                MediaControlPayload {
                    action: act.to_string(),
                    source: "system_media".to_string(),
                },
            );
        }
    }) {
        eprintln!("[Nocta MediaSession] 绑定媒体事件回调失败: {e:?}");
        return;
    }

    let _ = controls.set_playback(MediaPlayback::Stopped);

    if let Some(state) = app.try_state::<MediaSessionState>() {
        if let Ok(mut guard) = state.controls.lock() {
            *guard = Some(controls);
        }
    }
}

#[tauri::command]
pub fn sync_media_session_metadata(
    state: tauri::State<'_, MediaSessionState>,
    title: Option<String>,
    subtitle: Option<String>,
    duration_secs: Option<f64>,
) -> Result<(), String> {
    let Ok(mut guard) = state.controls.lock() else {
        return Ok(());
    };
    let Some(controls) = guard.as_mut() else {
        return Ok(());
    };

    let duration = duration_secs
        .filter(|d| d.is_finite() && *d > 0.0)
        .map(Duration::from_secs_f64);

    let metadata = MediaMetadata {
        title: title.as_deref(),
        artist: subtitle.as_deref(),
        album: Some("Nocta · 夜幕"),
        duration,
        cover_url: None,
    };

    if let Err(e) = controls.set_metadata(metadata) {
        eprintln!("[Nocta MediaSession] 更新媒体元数据失败: {e:?}");
    }
    Ok(())
}

#[tauri::command]
pub fn sync_media_session_playback(
    state: tauri::State<'_, MediaSessionState>,
    playback_state: String,
    position_secs: Option<f64>,
) -> Result<(), String> {
    let Ok(mut guard) = state.controls.lock() else {
        return Ok(());
    };
    let Some(controls) = guard.as_mut() else {
        return Ok(());
    };

    let progress = position_secs
        .filter(|p| p.is_finite() && *p >= 0.0)
        .map(|p| MediaPosition(Duration::from_secs_f64(p)));

    let playback = match playback_state.as_str() {
        "playing" => MediaPlayback::Playing { progress },
        "paused" => MediaPlayback::Paused { progress },
        _ => MediaPlayback::Stopped,
    };

    if let Err(e) = controls.set_playback(playback) {
        eprintln!("[Nocta MediaSession] 更新播放状态失败: {e:?}");
    }
    Ok(())
}

/// 初始化操作系统原生音频输出设备变更监听（用于检测蓝牙耳机断连、放回充电盒或拔出有线耳机）
pub fn init_audio_output_monitor(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    windows_audio::start(app.clone());

    #[cfg(target_os = "macos")]
    macos_audio::start(app.clone());

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "windows")]
mod windows_audio {
    use super::{should_pause_on_audio_route_change, AudioOutputChangedPayload, AUDIO_OUTPUT_CHANGED_EVENT};
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};
    use windows::core::{implement, Result as WinResult, PCWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        eConsole, eMultimedia, eRender, EDataFlow, ERole, IMMDevice, IMMDeviceEnumerator,
        IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED, STGM_READ,
    };

    const DEBOUNCE_WINDOW: Duration = Duration::from_millis(350);

    #[derive(Debug)]
    enum RawAudioEvent {
        DefaultChanged,
        StateChanged(String, u32),
    }

    #[implement(IMMNotificationClient)]
    struct AudioEndpointClient {
        tx: mpsc::Sender<RawAudioEvent>,
    }

    impl IMMNotificationClient_Impl for AudioEndpointClient_Impl {
        fn OnDeviceStateChanged(
            &self,
            pwstrdeviceid: &PCWSTR,
            dwnewstate: DEVICE_STATE,
        ) -> WinResult<()> {
            let id = unsafe { pwstrdeviceid.to_string().unwrap_or_default() };
            if !id.is_empty() {
                let _ = self.tx.send(RawAudioEvent::StateChanged(id, dwnewstate.0));
            }
            Ok(())
        }

        fn OnDeviceAdded(&self, _pwstrdeviceid: &PCWSTR) -> WinResult<()> {
            Ok(())
        }

        fn OnDeviceRemoved(&self, _pwstrdeviceid: &PCWSTR) -> WinResult<()> {
            Ok(())
        }

        fn OnDefaultDeviceChanged(
            &self,
            flow: EDataFlow,
            role: ERole,
            _pwstrdefaultdeviceid: &PCWSTR,
        ) -> WinResult<()> {
            if flow == eRender && (role == eMultimedia || role == eConsole) {
                let _ = self.tx.send(RawAudioEvent::DefaultChanged);
            }
            Ok(())
        }

        fn OnPropertyValueChanged(
            &self,
            _pwstrdeviceid: &PCWSTR,
            _key: &PROPERTYKEY,
        ) -> WinResult<()> {
            Ok(())
        }
    }

    fn read_device_friendly_name(device: &IMMDevice) -> Option<String> {
        unsafe {
            let store = device.OpenPropertyStore(STGM_READ).ok()?;
            let prop = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
            let text = prop.to_string();
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
    }

    fn query_default_render_device(enumerator: &IMMDeviceEnumerator) -> (Option<String>, Option<String>) {
        unsafe {
            let device = match enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .or_else(|_| enumerator.GetDefaultAudioEndpoint(eRender, eConsole))
            {
                Ok(d) => d,
                Err(_) => return (None, None),
            };
            let id = device.GetId().ok().and_then(|pwstr| {
                let s = pwstr.to_string().ok();
                CoTaskMemFree(Some(pwstr.0 as *const _));
                s
            });
            let name = read_device_friendly_name(&device);
            (id, name)
        }
    }

    fn is_device_still_active(enumerator: &IMMDeviceEnumerator, device_id: &str) -> bool {
        if device_id.is_empty() {
            return false;
        }
        let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let Ok(device) = enumerator.GetDevice(PCWSTR(wide.as_ptr())) else {
                return false;
            };
            match device.GetState() {
                Ok(state) => state == DEVICE_STATE_ACTIVE,
                Err(_) => false,
            }
        }
    }

    pub fn start(app: AppHandle) {
        let _ = std::thread::Builder::new()
            .name("nocta-audio-monitor".to_string())
            .spawn(move || unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                if hr.is_err() {
                    eprintln!("[Nocta AudioMonitor] CoInitializeEx 失败: {hr:?}");
                    return;
                }

                let result: WinResult<()> = (|| {
                    let enumerator: IMMDeviceEnumerator =
                        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER)?;
                    let (mut last_id, mut last_name) = query_default_render_device(&enumerator);

                    let (tx, rx) = mpsc::channel::<RawAudioEvent>();
                    let client: IMMNotificationClient = AudioEndpointClient { tx }.into();
                    enumerator.RegisterEndpointNotificationCallback(&client)?;

                    loop {
                        let first = match rx.recv() {
                            Ok(ev) => ev,
                            Err(_) => break,
                        };

                        // 合并 350ms 窗口内的连续路由/状态事件（防止 eConsole+eMultimedia 或蓝牙 HFP/A2DP 抖动）
                        let mut disconnected_last = matches!(
                            &first,
                            RawAudioEvent::StateChanged(id, state)
                                if last_id.as_deref() == Some(id.as_str())
                                    && *state != DEVICE_STATE_ACTIVE.0
                        );
                        let mut saw_default_change = matches!(first, RawAudioEvent::DefaultChanged);

                        loop {
                            match rx.recv_timeout(DEBOUNCE_WINDOW) {
                                Ok(RawAudioEvent::DefaultChanged) => {
                                    saw_default_change = true;
                                }
                                Ok(RawAudioEvent::StateChanged(id, state)) => {
                                    if last_id.as_deref() == Some(id.as_str())
                                        && state != DEVICE_STATE_ACTIVE.0
                                    {
                                        disconnected_last = true;
                                    }
                                }
                                Err(RecvTimeoutError::Timeout) => break,
                                Err(RecvTimeoutError::Disconnected) => return Ok(()),
                            }
                        }

                        if !saw_default_change && !disconnected_last {
                            continue;
                        }

                        let (curr_id, curr_name) = query_default_render_device(&enumerator);
                        let prev_id = last_id.clone();
                        let prev_name = last_name.clone();

                        // 同一设备未变更且未断连时忽略
                        if curr_id == prev_id && !disconnected_last {
                            continue;
                        }

                        let prev_removed = disconnected_last
                            || prev_id
                                .as_deref()
                                .map(|id| !is_device_still_active(&enumerator, id))
                                .unwrap_or(false);

                        let should_pause = should_pause_on_audio_route_change(
                            prev_removed,
                            false,
                            prev_name.as_deref(),
                            curr_name.as_deref(),
                        );

                        last_id = curr_id;
                        last_name = curr_name.clone();

                        let reason = if prev_removed {
                            "device_disconnected"
                        } else {
                            "default_device_changed"
                        };

                        let _ = app.emit(
                            AUDIO_OUTPUT_CHANGED_EVENT,
                            AudioOutputChangedPayload {
                                reason: reason.to_string(),
                                should_pause,
                                previous_device_name: prev_name,
                                current_device_name: curr_name,
                            },
                        );
                    }

                    let _ = enumerator.UnregisterEndpointNotificationCallback(&client);
                    Ok(())
                })();

                if let Err(e) = result {
                    eprintln!("[Nocta AudioMonitor] Windows 音频输出监听异常: {e:?}");
                }

                CoUninitialize();
            });
    }
}

#[cfg(target_os = "macos")]
mod macos_audio {
    use super::{should_pause_on_audio_route_change, AudioOutputChangedPayload, AUDIO_OUTPUT_CHANGED_EVENT};
    use std::ffi::{c_char, CStr};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
    static LAST_EMIT_AT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

    extern "C" {
        fn nocta_start_macos_audio_route_monitor();
    }

    pub fn start(app: AppHandle) {
        let _ = APP_HANDLE.set(app);
        let _ = LAST_EMIT_AT.set(Mutex::new(None));
        unsafe {
            nocta_start_macos_audio_route_monitor();
        }
    }

    #[no_mangle]
    pub extern "C" fn nocta_on_macos_audio_output_changed(
        previous_removed: bool,
        previous_was_headphone: bool,
        previous_name: *const c_char,
        current_name: *const c_char,
    ) {
        let Some(app) = APP_HANDLE.get() else {
            return;
        };

        if let Some(lock) = LAST_EMIT_AT.get() {
            if let Ok(mut guard) = lock.lock() {
                if let Some(last) = *guard {
                    if last.elapsed() < Duration::from_millis(300) {
                        return;
                    }
                }
                *guard = Some(Instant::now());
            }
        }

        let prev_str = if previous_name.is_null() {
            None
        } else {
            unsafe { CStr::from_ptr(previous_name) }
                .to_str()
                .ok()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        let curr_str = if current_name.is_null() {
            None
        } else {
            unsafe { CStr::from_ptr(current_name) }
                .to_str()
                .ok()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };

        let should_pause = should_pause_on_audio_route_change(
            previous_removed,
            previous_was_headphone,
            prev_str.as_deref(),
            curr_str.as_deref(),
        );

        let reason = if previous_removed {
            "device_disconnected"
        } else {
            "default_device_changed"
        };

        let _ = app.emit(
            AUDIO_OUTPUT_CHANGED_EVENT,
            AudioOutputChangedPayload {
                reason: reason.to_string(),
                should_pause,
                previous_device_name: prev_str,
                current_device_name: curr_str,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_route_change_pause_heuristics() {
        // 1. 原设备已断开/移除（如蓝牙耳机放回充电盒、拔出有线耳机）：无论设备名如何都应自动暂停
        assert!(should_pause_on_audio_route_change(
            true,
            false,
            Some("My Custom DAC"),
            Some("Speakers (Realtek Audio)")
        ));
        assert!(should_pause_on_audio_route_change(
            true,
            true,
            Some("Wade's AirPods"),
            None
        ));

        // 2. 从耳机切换回扬声器（即便原设备逻辑仍在线）：应自动暂停防止外放
        assert!(should_pause_on_audio_route_change(
            false,
            false,
            Some("Headphones (WH-1000XM5 Stereo)"),
            Some("扬声器 (Realtek(R) Audio)")
        ));
        assert!(should_pause_on_audio_route_change(
            false,
            true,
            Some("Bluetooth Device"),
            Some("MacBook Pro Speakers")
        ));

        // 3. 正在外放观影时连上蓝牙耳机（扬声器 → 耳机）：不应自动暂停，无缝切到耳机继续看
        assert!(!should_pause_on_audio_route_change(
            false,
            false,
            Some("Speakers (Realtek(R) Audio)"),
            Some("Headphones (AirPods Pro Stereo)")
        ));
        assert!(!should_pause_on_audio_route_change(
            false,
            false,
            Some("扬声器 (Realtek Audio)"),
            Some("Sony WH-1000XM5 蓝牙耳机")
        ));

        // 4. 在两副耳机之间切换（旧耳机仍在线）：不应暂停
        assert!(!should_pause_on_audio_route_change(
            false,
            true,
            Some("AirPods Pro"),
            Some("WH-1000XM5 Headset")
        ));
    }
}
