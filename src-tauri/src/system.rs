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

/// 唤起系统文件管理器（Windows 资源管理器 / macOS 访达 / Linux 文件管理器）
/// 并尽可能高亮选中目标文件；若目标是目录或高亮不可用，则打开所在目录。
pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("目标路径不存在: {}", path.display()));
    }

    #[cfg(target_os = "windows")]
    {
        let path_str = path.to_string_lossy().replace('/', "\\");
        let arg = format!("/select,{}", path_str);
        Command::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|e| format!("启动 Windows 资源管理器失败: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| format!("启动 macOS 访达 (Finder) 失败: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let target_dir = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(path)
        };
        Command::new("xdg-open")
            .arg(target_dir)
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
/// 并自动避免文件名冲突，默认自动在文件管理器/访达中高亮显示。
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

    // 写入备份内容
    fs::write(&candidate_path, content.as_bytes())
        .map_err(|e| format!("写入备份文件失败: {}", e))?;

    // 默认高亮打开所在文件管理器
    let should_reveal = reveal.unwrap_or(true);
    if should_reveal {
        let _ = reveal_in_file_manager(&candidate_path);
    }

    Ok(BackupSaveResult {
        success: true,
        file_path: candidate_path.to_string_lossy().to_string(),
        file_name: candidate_name,
        directory: download_dir.to_string_lossy().to_string(),
    })
}

/// 主动在文件管理器/访达中显示文件
#[tauri::command]
pub fn show_in_file_manager(path: String) -> Result<(), String> {
    let p = PathBuf::from(path);
    reveal_in_file_manager(&p)
}
