// src-tauri/src/system.rs

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupSaveResult {
    pub success: bool,
    pub file_path: String,
    pub file_name: String,
    pub directory: String,
}

/// 跨平台在系统文件管理器中直接打开指定目录（下载目录 / 文件夹）
/// 彻底规避 Windows explorer.exe /select, 传参时的引号错误导致意外回退到"文档"的缺陷。
pub fn open_directory_in_file_manager(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Err(format!("目录不存在: {}", dir.display()));
    }

    #[cfg(target_os = "windows")]
    {
        let dir_str = dir.to_string_lossy().replace('/', "\\");
        Command::new("explorer")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("启动 Windows 资源管理器失败: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("启动 macOS 访达 (Finder) 失败: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("启动 Linux 文件管理器失败: {}", e))?;
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("当前操作系统不支持打开文件管理器".to_string())
    }
}

/// 将备份数据内容保存到系统下载文件夹（Downloads）或备用用户目录，
/// 并自动避免同名文件覆盖，默认直接自动打开下载目录。
#[tauri::command]
pub async fn save_backup_file(
    app: tauri::AppHandle,
    content: String,
    filename: Option<String>,
    reveal: Option<bool>,
) -> Result<BackupSaveResult, String> {
    let download_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .or_else(|_| app.path().desktop_dir())
        .map_err(|e| format!("无法定位系统下载目录: {}", e))?;

    if !download_dir.exists() {
        fs::create_dir_all(&download_dir).map_err(|e| format!("创建下载目录失败: {}", e))?;
    }

    let base_name = filename.unwrap_or_else(|| "nocta-backup.json".to_string());
    
    // 分解基本名称与扩展名以支持避免覆盖重名
    let (stem, ext) = match base_name.rfind('.') {
        Some(idx) => (&base_name[..idx], &base_name[idx..]),
        None => (base_name.as_str(), ".json"),
    };

    let mut candidate_name = base_name.clone();
    let mut candidate_path = download_dir.join(&candidate_name);
    let mut counter = 1;

    // 若文件已存在，则自动递增序号：如 nocta-backup-2026-10-18 (1).json
    while candidate_path.exists() {
        candidate_name = format!("{} ({}){}", stem, counter, ext);
        candidate_path = download_dir.join(&candidate_name);
        counter += 1;
    }

    // 写入备份内容到下载目录
    fs::write(&candidate_path, content.as_bytes())
        .map_err(|e| format!("写入备份文件失败: {}", e))?;

    // 默认直接自动打开下载目录
    let should_reveal = reveal.unwrap_or(true);
    if should_reveal {
        let _ = open_directory_in_file_manager(&download_dir);
    }

    Ok(BackupSaveResult {
        success: true,
        file_path: candidate_path.to_string_lossy().to_string(),
        file_name: candidate_name,
        directory: download_dir.to_string_lossy().to_string(),
    })
}

/// 直接打开目标路径所在目录（自动提取父目录）
#[tauri::command]
pub fn show_in_file_manager(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let target_dir = if p.is_dir() {
        p
    } else {
        p.parent().map(|d| d.to_path_buf()).unwrap_or(p)
    };
    open_directory_in_file_manager(&target_dir)
}
