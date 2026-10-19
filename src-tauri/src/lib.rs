mod proxy;
mod sync;
mod system;

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
    if dst.symlink_metadata().is_ok() {
        // 若目标已是有效文件或有效软链则跳过；若是失效软链则先清理重建
        if dst.exists() {
            return;
        }
        let _ = std::fs::remove_file(dst);
    }
    let _ = std::os::unix::fs::symlink(src, dst);
}

#[cfg(target_os = "macos")]
fn init_macos_mpv_environment(resource_dir: Option<std::path::PathBuf>) {
    use std::path::PathBuf;

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let res_lib = resource_dir
        .map(|r| r.join("lib"))
        .or_else(|| {
            exe_dir
                .as_ref()
                .and_then(|d| d.parent().map(|contents| contents.join("Resources").join("lib")))
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

    if let Some(found_mpv) = mpv_candidates.into_iter().find(|p| p.exists()) {
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
            }

            Ok(())
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_libmpv::init())
        .invoke_handler(tauri::generate_handler![
            proxy::get_system_proxy,
            sync::sync_smb_test,
            sync::sync_smb_read,
            sync::sync_smb_write,
            system::save_backup_file,
            system::show_in_file_manager,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
