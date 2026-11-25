mod proxy;
mod sync;
mod system;
mod osd_overlay;
mod preload;
mod updater;
mod image_proxy;
mod media_session;
#[cfg(target_os = "macos")]
mod mpv_embed;

#[cfg(target_os = "macos")]
const MPV_EMBED_WINDOW_TITLE: &str = "Nocta Video Surface";

#[tauri::command]
async fn attach_mpv_window(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use std::time::Duration;

        let parent = window.ns_window().map_err(|e| e.to_string())? as usize;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        window
            .run_on_main_thread(move || {
                let attached =
                    mpv_embed::attach(parent as *mut std::ffi::c_void, MPV_EMBED_WINDOW_TITLE);
                let _ = tx.send(attached);
            })
            .map_err(|e| e.to_string())?;

        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(2))
                .map_err(|e| e.to_string())?
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(false)
    }
}

#[tauri::command]
fn detach_mpv_window(window: tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let _ = window.run_on_main_thread(mpv_embed::detach);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}

#[cfg(windows)]
fn init_windows_dll_directories() {
    use std::os::windows::ffi::OsStrExt;

    extern "system" {
        fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("lib"),
                exe_dir.join("resources").join("lib"),
                exe_dir.to_path_buf(),
            ];

            for dir in candidates {
                if dir.join("libmpv-wrapper.dll").exists() || dir.join("libmpv-2.dll").exists() {
                    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
                    unsafe {
                        SetDllDirectoryW(wide.as_ptr());
                    }
                    if let Ok(current_path) = std::env::var("PATH") {
                        let new_path = format!("{};{}", dir.display(), current_path);
                        std::env::set_var("PATH", new_path);
                    }
                    break;
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn ensure_unix_symlink(src: &std::path::Path, dst: &std::path::Path) {
    if let Ok(metadata) = dst.symlink_metadata() {
        if metadata.file_type().is_symlink() {
            if std::fs::read_link(dst).is_ok_and(|target| target == src) {
                return;
            }
            let _ = std::fs::remove_file(dst);
        } else {
            return;
        }
    }
    let _ = std::os::unix::fs::symlink(src, dst);
}

#[cfg(target_os = "macos")]
fn init_macos_mpv_environment(resource_dir: Option<std::path::PathBuf>) {
    use std::path::PathBuf;

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let res_lib = resource_dir.map(|r| r.join("lib")).or_else(|| {
        exe_dir.as_ref().and_then(|edir| {
            let bundle_lib = edir
                .parent()
                .map(|contents| contents.join("Resources").join("lib"));
            let dev_lib = edir.join("lib");
            match bundle_lib {
                Some(ref path) if path.exists() => Some(path.clone()),
                _ if dev_lib.exists() => Some(dev_lib),
                other => other,
            }
        })
    });

    let home_lib = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("lib"));
    if let Some(ref hlib) = home_lib {
        let _ = std::fs::create_dir_all(hlib);
    }

    if let (Some(ref edir), Some(ref rlib)) = (&exe_dir, &res_lib) {
        if rlib.exists() {
            let exe_lib = edir.join("lib");
            ensure_unix_symlink(rlib, &exe_lib);

            // 将 Resources/lib 下的所有 dylib 软链至 MacOS 目录与 $HOME/lib（兼容只读 DMG 挂载运行与 dyld 默认回退路径）
            if let Ok(entries) = std::fs::read_dir(rlib) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Some(name) = path.file_name() {
                        let name_str = name.to_string_lossy();
                        if name_str.ends_with(".dylib") {
                            ensure_unix_symlink(&path, &edir.join(name));
                            if let Some(ref hlib) = home_lib {
                                ensure_unix_symlink(&path, &hlib.join(name));
                            }
                        }
                    }
                }
            }
        }
    }

    // 探测可用的 libmpv.dylib（优先使用应用内置，其次探测 Homebrew / MacPorts / IINA）
    let mut mpv_candidates: Vec<PathBuf> = Vec::new();
    if let Some(ref rlib) = res_lib {
        mpv_candidates.push(rlib.join("libmpv.dylib"));
        mpv_candidates.push(rlib.join("libmpv.2.dylib"));
    }
    if let Some(ref edir) = exe_dir {
        mpv_candidates.push(edir.join("libmpv.dylib"));
        mpv_candidates.push(edir.join("libmpv.2.dylib"));
    }
    for sys_path in [
        "/opt/homebrew/lib/libmpv.dylib",
        "/opt/homebrew/lib/libmpv.2.dylib",
        "/opt/homebrew/opt/mpv/lib/libmpv.dylib",
        "/usr/local/lib/libmpv.dylib",
        "/usr/local/lib/libmpv.2.dylib",
        "/usr/local/opt/mpv/lib/libmpv.dylib",
        "/opt/local/lib/libmpv.dylib",
        "/Applications/IINA.app/Contents/Frameworks/libmpv.2.dylib",
    ] {
        mpv_candidates.push(PathBuf::from(sys_path));
    }

    // 预先尝试 dlopen 加载 libmpv-wrapper 与 libmpv（带 RTLD_GLOBAL），
    // 使得符号进入全局符号表，即便后续子模块发起无路径的 dlopen 也能命中内存缓存
    if let Some(ref rlib) = res_lib {
        let wrapper_path = rlib.join("libmpv-wrapper.dylib");
        if wrapper_path.exists() {
            if let Ok(c_str) = std::ffi::CString::new(wrapper_path.to_string_lossy().as_bytes()) {
                unsafe {
                    libc::dlopen(c_str.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL);
                }
            }
        }
    }

    if let Some(found_mpv) = mpv_candidates.into_iter().find(|p| p.exists()) {
        if let Ok(c_str) = std::ffi::CString::new(found_mpv.to_string_lossy().as_bytes()) {
            unsafe {
                libc::dlopen(c_str.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL);
            }
        }

        // libmpv-wrapper 在 macOS 下首先查找 current_exe().parent().join("libmpv.dylib")
        if let Some(ref edir) = exe_dir {
            ensure_unix_symlink(&found_mpv, &edir.join("libmpv.dylib"));
            ensure_unix_symlink(&found_mpv, &edir.join("libmpv.2.dylib"));
        }
        if let Some(ref rlib) = res_lib {
            if rlib.exists() {
                ensure_unix_symlink(&found_mpv, &rlib.join("libmpv.dylib"));
                ensure_unix_symlink(&found_mpv, &rlib.join("libmpv.2.dylib"));
            }
        }
        // 当 App 直接在只读 DMG 中运行时，MacOS 目录不可写，dlopen("libmpv.dylib") 会自动回退检索 $HOME/lib/libmpv.dylib
        if let Some(ref hlib) = home_lib {
            ensure_unix_symlink(&found_mpv, &hlib.join("libmpv.dylib"));
            ensure_unix_symlink(&found_mpv, &hlib.join("libmpv.2.dylib"));
        }
    }

    // 配置 Vulkan MoltenVK ICD 路径，确保 macOS GUI 模式下 vo=gpu-next (macvk) 能正常初始化
    if std::env::var_os("VK_ICD_FILENAMES").is_none() {
        let mut icd_candidates: Vec<PathBuf> = Vec::new();
        if let Some(ref rlib) = res_lib {
            icd_candidates.push(rlib.join("MoltenVK_icd.json"));
        }
        for sys_icd in [
            "/opt/homebrew/share/vulkan/icd.d/MoltenVK_icd.json",
            "/opt/homebrew/opt/molten-vk/share/vulkan/icd.d/MoltenVK_icd.json",
            "/opt/homebrew/etc/vulkan/icd.d/MoltenVK_icd.json",
            "/usr/local/share/vulkan/icd.d/MoltenVK_icd.json",
            "/usr/local/opt/molten-vk/share/vulkan/icd.d/MoltenVK_icd.json",
            "/usr/local/etc/vulkan/icd.d/MoltenVK_icd.json",
        ] {
            icd_candidates.push(PathBuf::from(sys_icd));
        }
        if let Some(found_icd) = icd_candidates.into_iter().find(|p| p.exists()) {
            std::env::set_var("VK_ICD_FILENAMES", &found_icd);
            std::env::set_var("VK_DRIVER_FILES", &found_icd);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    init_windows_dll_directories();

    #[cfg(target_os = "macos")]
    init_macos_mpv_environment(None);

    tauri::Builder::default()
        .manage(updater::UpdaterState::default())
        .manage(media_session::MediaSessionState::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                use std::os::windows::ffi::OsStrExt;
                use tauri::Manager;

                extern "system" {
                    fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
                }

                if let Ok(resource_dir) = app.path().resource_dir() {
                    let candidates = [
                        resource_dir.join("lib"),
                        resource_dir.clone(),
                    ];
                    for dir in candidates {
                        if dir.join("libmpv-wrapper.dll").exists() || dir.join("libmpv-2.dll").exists() {
                            let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
                            unsafe {
                                SetDllDirectoryW(wide.as_ptr());
                            }
                            if let Ok(current_path) = std::env::var("PATH") {
                                let new_path = format!("{};{}", dir.display(), current_path);
                                std::env::set_var("PATH", new_path);
                            }
                            break;
                        }
                    }
                }
            }

            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                init_macos_mpv_environment(app.path().resource_dir().ok());
                if let Some(main_win) = app.get_webview_window("main") {
                    if let Ok(ns_win) = main_win.ns_window() {
                        let ns_win_addr = ns_win as usize;
                        let _ = main_win.run_on_main_thread(move || {
                            mpv_embed::configure_main_window(ns_win_addr as *mut std::ffi::c_void);
                        });
                    }
                }
            }

            media_session::init_media_session(app.handle());
            media_session::init_audio_output_monitor(app.handle());
            proxy::init_app_handle(app.handle());

            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("nocta-img", |_ctx, request, responder| {
            image_proxy::handle_image_protocol_request(request, responder);
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            attach_mpv_window,
            detach_mpv_window,
            osd_overlay::open_osd_overlay,
            osd_overlay::show_osd_overlay,
            osd_overlay::close_osd_overlay,
            proxy::get_system_proxy,
            proxy::sync_runtime_proxy_config,
            proxy::ensure_socks5_http_bridge,
            sync::sync_smb_test,
            sync::sync_smb_read,
            sync::sync_smb_write,
            system::save_backup_file,
            system::show_in_file_manager,
            system::get_screenshot_dir,
            preload::start_next_episode_preload,
            preload::activate_preloaded_episode,
            preload::release_active_preload_memory,
            preload::get_preload_status,
            preload::cancel_next_episode_preload,
            preload::clear_all_preloads,
            preload::diagnose_stream_url,
            preload::start_stream_relay,
            preload::stop_stream_relay,
            updater::get_updater_runtime_info,
            updater::check_app_update,
            updater::download_and_install_update,
            updater::relaunch_app,
            media_session::sync_media_session_metadata,
            media_session::sync_media_session_playback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
