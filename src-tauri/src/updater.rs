use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex as StdMutex,
};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use tokio::sync::Mutex;
use url::Url;

pub const STABLE_RELEASE_MANIFEST_URL: &str =
    "https://github.com/wade6716/Nocta/releases/latest/download/latest.json";
pub const STABLE_RAW_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/wade6716/Nocta/updater-manifests/stable.json";
pub const PRERELEASE_RAW_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/wade6716/Nocta/updater-manifests/prerelease.json";
pub const GITHUB_REPO_API_URL: &str = "https://api.github.com/repos/wade6716/Nocta";

pub const UPDATER_PROGRESS_EVENT: &str = "updater://progress";

pub struct PendingUpdate {
    pub update: Update,
}

#[derive(Default)]
pub struct UpdaterState(pub Mutex<Option<PendingUpdate>>);

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateOptions {
    pub channel: Option<String>,
    pub proxy_url: Option<String>,
    pub mirror_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub date: Option<String>,
    pub body: Option<String>,
    pub download_url: Option<String>,
    pub channel: String,
    pub used_proxy: bool,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgressEvent {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub percent: Option<f64>,
    pub speed_bps: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateResult {
    pub installed: bool,
    pub requires_restart: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterRuntimeInfo {
    pub version: String,
    pub target: String,
    pub is_prerelease: bool,
    pub configured: bool,
}

/// 返回标准化的 `<os>-<arch>` 标识，方便与 Tauri 更新清单平台键对齐
pub fn current_platform_target() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    let arch = std::env::consts::ARCH;
    format!("{}-{}", os, arch)
}

/// 标准化 GitHub 镜像前缀：去除空白、要求 http(s) 协议并补齐末尾斜杠
pub fn normalize_mirror_prefix(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return None;
    }
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
        return None;
    }
    let parsed = Url::parse(trimmed).ok()?;
    if parsed.host_str().is_none() {
        return None;
    }
    let mut normalized = trimmed.to_string();
    if !normalized.ends_with('/') {
        normalized.push('/');
    }
    Some(normalized)
}

/// 为指定 URL 叠加镜像前缀（避免重复叠加）
pub fn apply_mirror_prefix(target_url: &str, mirror_prefix: Option<&str>) -> Option<Url> {
    let prefix = normalize_mirror_prefix(mirror_prefix)?;
    if target_url.starts_with(&prefix) {
        return Url::parse(target_url).ok();
    }
    Url::parse(&format!("{}{}", prefix, target_url)).ok()
}

/// 根据更新通道与可选加速镜像构建去重后的有序更新清单端点
pub fn build_channel_endpoints(channel: &str, mirror_prefix: Option<&str>) -> Vec<Url> {
    let base_urls: &[&str] = if channel.eq_ignore_ascii_case("prerelease") {
        &[PRERELEASE_RAW_MANIFEST_URL, STABLE_RELEASE_MANIFEST_URL]
    } else {
        &[STABLE_RELEASE_MANIFEST_URL, STABLE_RAW_MANIFEST_URL]
    };

    let mut endpoints: Vec<Url> = Vec::new();
    let mut push_unique = |candidate: Option<Url>| {
        if let Some(u) = candidate {
            if !endpoints.iter().any(|existing| existing.as_str() == u.as_str()) {
                endpoints.push(u);
            }
        }
    };

    if normalize_mirror_prefix(mirror_prefix).is_some() {
        for base in base_urls {
            push_unique(apply_mirror_prefix(base, mirror_prefix));
        }
    }

    for base in base_urls {
        push_unique(Url::parse(base).ok());
    }

    endpoints
}

fn parse_proxy_url(raw: Option<&str>) -> Option<Url> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 将 socks5:// 与 socks:// 升级为 socks5h://，由代理远端解析 GitHub DNS
    let normalized = if let Some(rest) = trimmed.strip_prefix("socks5://") {
        format!("socks5h://{}", rest)
    } else if let Some(rest) = trimmed.strip_prefix("socks://") {
        format!("socks5h://{}", rest)
    } else {
        trimmed.to_string()
    };
    Url::parse(&normalized).ok()
}

fn build_updater(
    app: &tauri::AppHandle,
    endpoints: Vec<Url>,
    proxy: Option<&Url>,
    disable_proxy: bool,
) -> Result<Updater, String> {
    let mut builder = app
        .updater_builder()
        .endpoints(endpoints)
        .map_err(|e| format!("配置更新源失败: {}", e))?;

    if disable_proxy {
        builder = builder.no_proxy();
    } else if let Some(proxy_url) = proxy {
        builder = builder.proxy(proxy_url.clone());
    }

    builder
        .build()
        .map_err(|e| format!("初始化更新引擎失败: {}", e))
}

fn build_helper_reqwest_client(
    proxy: Option<&Url>,
    disable_proxy: bool,
    timeout_secs: u64,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("Nocta-Updater");

    if disable_proxy {
        builder = builder.no_proxy();
    } else if let Some(proxy_url) = proxy {
        let proxy_cfg = reqwest::Proxy::all(proxy_url.as_str())
            .map_err(|e| format!("代理配置无效: {}", e))?;
        builder = builder.proxy(proxy_cfg);
    }

    builder
        .build()
        .map_err(|e| format!("初始化更新辅助网络客户端失败: {}", e))
}

async fn send_diag_once(
    url: &str,
    accept: &str,
    proxy: Option<&Url>,
    no_proxy: bool,
) -> Option<u16> {
    let client = build_helper_reqwest_client(proxy, no_proxy, 6).ok()?;
    let mut req = client.get(url).header("Accept", accept);
    if accept.contains("github") {
        req = req.header("X-GitHub-Api-Version", "2022-11-28");
    }
    req.send().await.ok().map(|r| r.status().as_u16())
}

async fn send_diag_get(url: &str, accept: &str, proxy: Option<&Url>) -> Option<(u16, bool)> {
    if let Some(p) = proxy {
        if let Some(code) = send_diag_once(url, accept, Some(p), false).await {
            return Some((code, false));
        }
        if let Some(code) = send_diag_once(url, accept, None, true).await {
            return Some((code, true));
        }
        None
    } else {
        send_diag_once(url, accept, None, false)
            .await
            .map(|code| (code, false))
    }
}

/// `tauri-plugin-updater` 会把 404/网络错误统一折叠为 "Could not fetch a valid release JSON"，
/// 这里补充一次轻量诊断以区分「仓库不可见」「尚无正式版清单」等常见原因
async fn diagnose_manifest_failure(
    manifest_url: &Url,
    channel: &str,
    proxy: Option<&Url>,
) -> Option<String> {
    let (status, used_direct) =
        send_diag_get(manifest_url.as_str(), "application/json, */*", proxy).await?;

    if status == 404 {
        let effective_proxy = if used_direct { None } else { proxy };
        let repo_status = send_diag_get(
            GITHUB_REPO_API_URL,
            "application/vnd.github+json",
            effective_proxy,
        )
        .await
        .map(|(s, _)| s);

        return Some(match repo_status {
            Some(404) => "无法获取更新清单 (HTTP 404)：GitHub 仓库 wade6716/Nocta 当前不可公开访问，请稍后重试或前往 GitHub Releases 手动下载。".to_string(),
            Some(200) if channel.eq_ignore_ascii_case("stable") => "当前仓库尚未发布正式版（Stable）更新清单 (HTTP 404)，仅有预发布版本，请切换至「预发布尝鲜版」通道检查更新。".to_string(),
            _ => format!(
                "未找到更新清单 (HTTP 404: {})，请确认对应通道的 Release 已完成构建并推送 updater-manifests。",
                manifest_url
            ),
        });
    }

    if !(200..300).contains(&status) {
        return Some(format!("远端更新清单返回异常状态 (HTTP {})", status));
    }

    None
}
fn normalize_channel(raw: Option<&str>) -> String {
    match raw.map(str::trim) {
        Some(c) if c.eq_ignore_ascii_case("prerelease") => "prerelease".to_string(),
        _ => "stable".to_string(),
    }
}

#[tauri::command]
pub fn get_updater_runtime_info(app: tauri::AppHandle) -> UpdaterRuntimeInfo {
    let version = app.package_info().version.to_string();
    let lower = version.to_lowercase();
    let is_prerelease =
        lower.contains("-alpha") || lower.contains("-beta") || lower.contains("-rc");
    let configured = app.updater_builder().build().is_ok();

    UpdaterRuntimeInfo {
        version,
        target: current_platform_target(),
        is_prerelease,
        configured,
    }
}

#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
    options: Option<CheckUpdateOptions>,
) -> Result<UpdateCheckResult, String> {
    let opts = options.unwrap_or_default();
    let channel = normalize_channel(opts.channel.as_deref());
    let mirror_prefix = normalize_mirror_prefix(opts.mirror_prefix.as_deref());
    let parsed_proxy = parse_proxy_url(opts.proxy_url.as_deref());
    let endpoints = build_channel_endpoints(&channel, mirror_prefix.as_deref());
    let current_version = app.package_info().version.to_string();
    let target = current_platform_target();

    if endpoints.is_empty() {
        return Err("未能生成有效的更新检查地址".to_string());
    }

    let mut used_proxy = parsed_proxy.is_some();
    let primary_updater = build_updater(&app, endpoints.clone(), parsed_proxy.as_ref(), false)?;

    let check_result = match primary_updater.check().await {
        Ok(res) => res,
        Err(primary_err) if parsed_proxy.is_some() => {
            // 当代理不可达时自动降级直连重试一次，避免假死报错
            eprintln!(
                "[Nocta Updater] 代理检查更新失败，尝试直连回退: {}",
                primary_err
            );
            let direct_updater = build_updater(&app, endpoints.clone(), None, true)?;
            match direct_updater.check().await {
                Ok(res) => {
                    used_proxy = false;
                    res
                }
                Err(direct_err) => {
                    let primary_msg = primary_err.to_string();
                    let direct_msg = direct_err.to_string();
                    if primary_msg.contains("Could not fetch a valid release JSON")
                        || direct_msg.contains("Could not fetch a valid release JSON")
                    {
                        if let Some(diag) = diagnose_manifest_failure(
                            &endpoints[0],
                            &channel,
                            parsed_proxy.as_ref(),
                        )
                        .await
                        {
                            return Err(diag);
                        }
                    }
                    return Err(format!(
                        "检查更新失败（代理失败: {}; 直连失败: {}）",
                        primary_msg, direct_msg
                    ));
                }
            }
        }
        Err(err) => {
            let err_msg = err.to_string();
            if err_msg.contains("Could not fetch a valid release JSON") {
                if let Some(diag) = diagnose_manifest_failure(
                    &endpoints[0],
                    &channel,
                    None,
                )
                .await
                {
                    return Err(diag);
                }
            }
            return Err(format!("检查更新失败: {}", err_msg));
        }
    };

    if let Some(mut update) = check_result {
        if let Some(mirrored_download) =
            apply_mirror_prefix(update.download_url.as_str(), mirror_prefix.as_deref())
        {
            update.download_url = mirrored_download;
        }

        let dto = UpdateCheckResult {
            available: true,
            current_version: update.current_version.clone(),
            version: Some(update.version.clone()),
            date: update.date.as_ref().map(|d| d.to_string()),
            body: update.body.clone(),
            download_url: Some(update.download_url.to_string()),
            channel: channel.clone(),
            used_proxy,
            target,
        };

        let mut guard = state.0.lock().await;
        *guard = Some(PendingUpdate { update });

        Ok(dto)
    } else {
        let mut guard = state.0.lock().await;
        *guard = None;

        Ok(UpdateCheckResult {
            available: false,
            current_version,
            version: None,
            date: None,
            body: None,
            download_url: None,
            channel,
            used_proxy,
            target,
        })
    }
}

async fn cleanup_before_install_or_restart(app: &tauri::AppHandle) {
    if let Some(overlay) = app.get_webview_window(crate::osd_overlay::OSD_OVERLAY_LABEL) {
        let _ = overlay.close();
    }
    let _ = crate::preload::clear_all_preloads().await;
    let _ = crate::preload::stop_stream_relay(None).await;
}

struct ProgressTracker {
    started_at: Instant,
    last_emit_at: Instant,
}

#[tauri::command]
pub async fn download_and_install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<InstallUpdateResult, String> {
    let pending = {
        let mut guard = state.0.lock().await;
        guard.take()
    };

    let Some(pending) = pending else {
        return Err("未找到待安装的更新包信息，请先重新检查更新".to_string());
    };

    cleanup_before_install_or_restart(&app).await;

    let _ = app.emit(
        UPDATER_PROGRESS_EVENT,
        UpdateProgressEvent {
            stage: "downloading".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(0.0),
            speed_bps: Some(0.0),
        },
    );

    let downloaded = Arc::new(AtomicU64::new(0));
    let tracker = Arc::new(StdMutex::new(ProgressTracker {
        started_at: Instant::now(),
        last_emit_at: Instant::now() - Duration::from_secs(1),
    }));

    let app_for_chunk = app.clone();
    let downloaded_for_chunk = Arc::clone(&downloaded);
    let tracker_for_chunk = Arc::clone(&tracker);

    let app_for_finish = app.clone();
    let downloaded_for_finish = Arc::clone(&downloaded);

    pending
        .update
        .download_and_install(
            move |chunk_len, content_len| {
                let total_down = downloaded_for_chunk.fetch_add(chunk_len as u64, Ordering::Relaxed)
                    + chunk_len as u64;
                let now = Instant::now();
                let is_complete = content_len
                    .map(|total| total > 0 && total_down >= total)
                    .unwrap_or(false);

                let should_emit = if let Ok(mut guard) = tracker_for_chunk.lock() {
                    if is_complete
                        || now.duration_since(guard.last_emit_at) >= Duration::from_millis(100)
                    {
                        guard.last_emit_at = now;
                        let elapsed = now.duration_since(guard.started_at).as_secs_f64();
                        let speed_bps = if elapsed > 0.05 {
                            Some(total_down as f64 / elapsed)
                        } else {
                            None
                        };
                        let percent = content_len.and_then(|total| {
                            if total > 0 {
                                Some(((total_down as f64 / total as f64) * 100.0).min(100.0))
                            } else {
                                None
                            }
                        });
                        Some((percent, speed_bps))
                    } else {
                        None
                    }
                } else {
                    None
                };

                if let Some((percent, speed_bps)) = should_emit {
                    let _ = app_for_chunk.emit(
                        UPDATER_PROGRESS_EVENT,
                        UpdateProgressEvent {
                            stage: "downloading".to_string(),
                            downloaded_bytes: total_down,
                            total_bytes: content_len,
                            percent,
                            speed_bps,
                        },
                    );
                }
            },
            move || {
                if let Some(overlay) =
                    app_for_finish.get_webview_window(crate::osd_overlay::OSD_OVERLAY_LABEL)
                {
                    let _ = overlay.close();
                }
                let final_bytes = downloaded_for_finish.load(Ordering::Relaxed);
                let _ = app_for_finish.emit(
                    UPDATER_PROGRESS_EVENT,
                    UpdateProgressEvent {
                        stage: "installing".to_string(),
                        downloaded_bytes: final_bytes,
                        total_bytes: if final_bytes > 0 {
                            Some(final_bytes)
                        } else {
                            None
                        },
                        percent: Some(100.0),
                        speed_bps: None,
                    },
                );
            },
        )
        .await
        .map_err(|e| format!("下载或安装更新失败: {}", e))?;

    let final_bytes = downloaded.load(Ordering::Relaxed);
    let _ = app.emit(
        UPDATER_PROGRESS_EVENT,
        UpdateProgressEvent {
            stage: "ready".to_string(),
            downloaded_bytes: final_bytes,
            total_bytes: if final_bytes > 0 {
                Some(final_bytes)
            } else {
                None
            },
            percent: Some(100.0),
            speed_bps: None,
        },
    );

    Ok(InstallUpdateResult {
        installed: true,
        requires_restart: !cfg!(target_os = "windows"),
    })
}

#[tauri::command]
pub async fn relaunch_app(app: tauri::AppHandle) -> Result<(), String> {
    cleanup_before_install_or_restart(&app).await;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_mirror_prefix() {
        assert_eq!(normalize_mirror_prefix(None), None);
        assert_eq!(normalize_mirror_prefix(Some("   ")), None);
        assert_eq!(normalize_mirror_prefix(Some("ftp://mirror.test")), None);
        assert_eq!(
            normalize_mirror_prefix(Some("https://mirror.test/path with space")),
            None
        );
        assert_eq!(
            normalize_mirror_prefix(Some("https://ghproxy.example.com")),
            Some("https://ghproxy.example.com/".to_string())
        );
        assert_eq!(
            normalize_mirror_prefix(Some(" https://ghproxy.example.com/ ")),
            Some("https://ghproxy.example.com/".to_string())
        );
    }

    #[test]
    fn test_build_channel_endpoints_prerelease_without_mirror() {
        let urls = build_channel_endpoints("prerelease", None);
        let strs: Vec<&str> = urls.iter().map(Url::as_str).collect();
        assert_eq!(
            strs,
            vec![PRERELEASE_RAW_MANIFEST_URL, STABLE_RELEASE_MANIFEST_URL]
        );
    }

    #[test]
    fn test_build_channel_endpoints_stable_with_mirror_and_dedup() {
        let urls = build_channel_endpoints("stable", Some("https://gh-mirror.example.com"));
        let strs: Vec<&str> = urls.iter().map(Url::as_str).collect();
        assert_eq!(
            strs,
            vec![
                "https://gh-mirror.example.com/https://github.com/wade6716/Nocta/releases/latest/download/latest.json",
                "https://gh-mirror.example.com/https://raw.githubusercontent.com/wade6716/Nocta/updater-manifests/stable.json",
                STABLE_RELEASE_MANIFEST_URL,
                STABLE_RAW_MANIFEST_URL,
            ]
        );
    }

    #[test]
    fn test_apply_mirror_prefix_avoids_double_prefix() {
        let mirrored = apply_mirror_prefix(
            "https://gh-mirror.example.com/https://github.com/a/b",
            Some("https://gh-mirror.example.com/"),
        )
        .unwrap();
        assert_eq!(
            mirrored.as_str(),
            "https://gh-mirror.example.com/https://github.com/a/b"
        );
    }

    #[test]
    fn test_parse_proxy_url_normalizes_socks_variants() {
        assert_eq!(parse_proxy_url(Some("   ")), None);
        assert_eq!(
            parse_proxy_url(Some("socks5://127.0.0.1:10808"))
                .unwrap()
                .as_str(),
            "socks5h://127.0.0.1:10808"
        );
        assert_eq!(
            parse_proxy_url(Some("socks://127.0.0.1:10808"))
                .unwrap()
                .as_str(),
            "socks5h://127.0.0.1:10808"
        );
        assert_eq!(
            parse_proxy_url(Some("socks5h://127.0.0.1:10808"))
                .unwrap()
                .as_str(),
            "socks5h://127.0.0.1:10808"
        );
        assert_eq!(
            parse_proxy_url(Some("http://127.0.0.1:7890"))
                .unwrap()
                .as_str(),
            "http://127.0.0.1:7890/"
        );
    }
}
