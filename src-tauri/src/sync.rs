// src-tauri/src/sync.rs

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmbConfigPayload {
    pub host: String,
    pub share: String,
    pub path: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmbTestResult {
    pub ok: bool,
    pub file_exists: bool,
    pub latency: u64,
    pub error: Option<String>,
}

#[cfg(target_os = "windows")]
mod win_smb {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct NetResourceW {
        dw_scope: u32,
        dw_type: u32,
        dw_display_type: u32,
        dw_usage: u32,
        lp_local_name: *mut u16,
        lp_remote_name: *mut u16,
        lp_comment: *mut u16,
        lp_provider: *mut u16,
    }

    #[link(name = "mpr")]
    extern "system" {
        fn WNetAddConnection2W(
            lp_net_resource: *const NetResourceW,
            lp_password: *const u16,
            lp_user_name: *const u16,
            dw_flags: u32,
        ) -> u32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn connect_share(
        share: &str,
        username: Option<&str>,
        password: Option<&str>,
        domain: Option<&str>,
    ) -> Result<(), String> {
        // 无账号密码时不强行注入认证
        let has_user = username.map(|u| !u.trim().is_empty()).unwrap_or(false);
        let has_pass = password.map(|p| !p.trim().is_empty()).unwrap_or(false);
        if !has_user && !has_pass {
            return Ok(());
        }

        let mut remote_wide = to_wide(share);

        // 如果包含 domain，Windows 格式通常为 "DOMAIN\username"
        let full_user = match (domain, username) {
            (Some(d), Some(u)) if !d.trim().is_empty() && !u.contains('\\') => {
                format!("{}\\{}", d.trim(), u.trim())
            }
            (_, Some(u)) => u.to_string(),
            _ => String::new(),
        };

        let user_wide = if !full_user.is_empty() {
            Some(to_wide(&full_user))
        } else {
            None
        };

        let pass_wide = password.map(to_wide);

        let nr = NetResourceW {
            dw_scope: 0,
            dw_type: 1, // RESOURCETYPE_DISK
            dw_display_type: 0,
            dw_usage: 0,
            lp_local_name: std::ptr::null_mut(),
            lp_remote_name: remote_wide.as_mut_ptr(),
            lp_comment: std::ptr::null_mut(),
            lp_provider: std::ptr::null_mut(),
        };

        let user_ptr = user_wide.as_ref().map(|v| v.as_ptr()).unwrap_or(std::ptr::null());
        let pass_ptr = pass_wide.as_ref().map(|v| v.as_ptr()).unwrap_or(std::ptr::null());

        let res = unsafe {
            WNetAddConnection2W(&nr, pass_ptr, user_ptr, 0x00000004) // CONNECT_TEMPORARY
        };

        // 0: NO_ERROR, 1219: ERROR_SESSION_CREDENTIAL_CONFLICT (已存在连接), 85: ERROR_ALREADY_ASSIGNED
        if res == 0 || res == 1219 || res == 85 {
            Ok(())
        } else {
            let err_desc = match res {
                5 => "访问被拒绝 (Access Denied: 请检查共享权限或密码)".to_string(),
                53 => "网络路径未找到 (Network Path Not Found: 请检查主机名与共享名称)".to_string(),
                67 => "网络名称未找到 (Network Name Not Found)".to_string(),
                1203 => "无网络提供者接受给定路径".to_string(),
                1326 => "登录失败: 用户名或密码错误 (Logon Failure)".to_string(),
                _ => format!("SMB 认证错误代码: {}", res),
            };
            Err(err_desc)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod non_win_smb {
    pub fn connect_share(
        _share: &str,
        _username: Option<&str>,
        _password: Option<&str>,
        _domain: Option<&str>,
    ) -> Result<(), String> {
        Ok(())
    }
}

fn resolve_paths(payload: &SmbConfigPayload) -> (String, PathBuf) {
    let raw_host = payload.host.trim();
    let raw_share = payload.share.trim();
    let raw_path = payload.path.as_deref().unwrap_or("").trim();

    // 如果 host 带有盘符，如 "Z:" 或 "Z:\" 或本地路径
    if raw_host.contains(':') && !raw_host.starts_with("smb://") {
        let base = raw_host.replace('/', "\\");
        let mut full = PathBuf::from(&base);
        if !raw_share.is_empty() {
            full.push(raw_share.trim_matches(&['/', '\\'][..]));
        }
        if !raw_path.is_empty() {
            full.push(raw_path.trim_matches(&['/', '\\'][..]));
        }
        return (base, full);
    }

    // 标准 SMB 路径：smb://host 或 \\host 或 192.168.1.100
    let clean_host = raw_host
        .trim_start_matches("smb://")
        .trim_start_matches(r"\\")
        .trim_matches(&['/', '\\'][..]);

    let clean_share = raw_share.trim_matches(&['/', '\\'][..]);
    let clean_path = raw_path.trim_matches(&['/', '\\'][..]);

    let root_share = format!(r"\\{}\{}", clean_host, clean_share);

    let mut full_dir = PathBuf::from(&root_share);
    if !clean_path.is_empty() {
        full_dir.push(clean_path.replace('/', "\\"));
    }

    (root_share, full_dir)
}

fn connect_if_needed(payload: &SmbConfigPayload, root_share: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_smb::connect_share(
            root_share,
            payload.username.as_deref(),
            payload.password.as_deref(),
            payload.domain.as_deref(),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        non_win_smb::connect_share(
            root_share,
            payload.username.as_deref(),
            payload.password.as_deref(),
            payload.domain.as_deref(),
        )
    }
}

#[tauri::command]
pub fn sync_smb_test(payload: SmbConfigPayload, file_name: Option<String>) -> SmbTestResult {
    let start = Instant::now();
    let target_file_name = file_name.unwrap_or_else(|| "nocta-sync.json".to_string());
    let (root_share, full_dir) = resolve_paths(&payload);

    if let Err(err) = connect_if_needed(&payload, &root_share) {
        return SmbTestResult {
            ok: false,
            file_exists: false,
            latency: start.elapsed().as_millis() as u64,
            error: Some(err),
        };
    }

    // 检查目录是否存在；若不存在尝试创建测试写权限
    if !full_dir.exists() {
        if let Err(e) = fs::create_dir_all(&full_dir) {
            return SmbTestResult {
                ok: false,
                file_exists: false,
                latency: start.elapsed().as_millis() as u64,
                error: Some(format!("目标目录不存在且无法创建: {}", e)),
            };
        }
    }

    let target_file = full_dir.join(&target_file_name);
    let file_exists = target_file.is_file();

    SmbTestResult {
        ok: true,
        file_exists,
        latency: start.elapsed().as_millis() as u64,
        error: None,
    }
}

#[tauri::command]
pub fn sync_smb_read(payload: SmbConfigPayload, file_name: String) -> Result<String, String> {
    let (root_share, full_dir) = resolve_paths(&payload);
    connect_if_needed(&payload, &root_share)?;

    let target_file = full_dir.join(&file_name);
    if !target_file.is_file() {
        return Err("远程配置文件不存在".to_string());
    }

    fs::read_to_string(&target_file).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
pub fn sync_smb_write(
    payload: SmbConfigPayload,
    file_name: String,
    content: String,
) -> Result<(), String> {
    let (root_share, full_dir) = resolve_paths(&payload);
    connect_if_needed(&payload, &root_share)?;

    if !full_dir.exists() {
        fs::create_dir_all(&full_dir).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let target_file = full_dir.join(&file_name);
    fs::write(&target_file, content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(())
}
