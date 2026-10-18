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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    init_windows_dll_directories();

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
                if let (Ok(exe_path), Ok(resource_dir)) = (std::env::current_exe(), app.path().resource_dir()) {
                    if let Some(exe_dir) = exe_path.parent() {
                        let res_lib = resource_dir.join("lib");
                        let exe_lib = exe_dir.join("lib");
                        if res_lib.exists() && !exe_lib.exists() {
                            let _ = std::os::unix::fs::symlink(&res_lib, &exe_lib);
                        }
                    }
                }
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
