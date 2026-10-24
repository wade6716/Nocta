use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const OSD_OVERLAY_LABEL: &str = "osd-overlay";

#[tauri::command]
pub async fn open_osd_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(OSD_OVERLAY_LABEL).is_some() {
        return Ok(());
    }

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口".to_string())?;

    let monitor = main
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| main.primary_monitor().ok().flatten())
        .ok_or_else(|| "未找到可用显示器".to_string())?;

    let scale = monitor.scale_factor();
    let position = monitor.position();
    let size = monitor.size();

    let overlay = match WebviewWindowBuilder::new(
        &app,
        OSD_OVERLAY_LABEL,
        WebviewUrl::App("index.html?osd=1".into()),
    )
    .title("Nocta OSD")
    .transparent(true)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .focused(false)
    .visible(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .position(position.x as f64 / scale, position.y as f64 / scale)
    .inner_size(size.width as f64 / scale, size.height as f64 / scale)
    .build()
    {
        Ok(window) => window,
        Err(err) => {
            // 并发调用（如 React StrictMode 双执行）时另一个请求可能已注册同名窗口
            if app.get_webview_window(OSD_OVERLAY_LABEL).is_some() {
                return Ok(());
            }
            return Err(err.to_string());
        }
    };

    #[cfg(target_os = "macos")]
    {
        let ns_window = overlay.ns_window().map_err(|e| e.to_string())? as usize;
        overlay
            .run_on_main_thread(move || {
                crate::mpv_embed::configure_osd_overlay(ns_window as *mut std::ffi::c_void);
            })
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn close_osd_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window(OSD_OVERLAY_LABEL) {
        let _ = overlay.close();
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }

    Ok(())
}

#[tauri::command]
pub async fn show_osd_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window(OSD_OVERLAY_LABEL)
        .ok_or_else(|| "OSD 浮层窗口不存在".to_string())?;

    overlay.show().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let ns_window = overlay.ns_window().map_err(|e| e.to_string())? as usize;
        overlay
            .run_on_main_thread(move || {
                crate::mpv_embed::configure_osd_overlay(ns_window as *mut std::ffi::c_void);
            })
            .map_err(|e| e.to_string())?;
    }

    overlay.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
