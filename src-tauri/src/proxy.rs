// src-tauri/src/proxy.rs

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemProxyInfo {
    pub enabled: bool,
    pub url: Option<String>,
}

/// 标准化代理字符串为完整的协议 URL (如 http://127.0.0.1:7890 或 socks5://127.0.0.1:10808)
fn normalize_proxy_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    // 处理复合代理字符串，如 "http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:10808"
    if raw.contains(';') || raw.contains('=') {
        let mut http_proxy = None;
        let mut socks_proxy = None;
        for part in raw.split(';') {
            let part = part.trim();
            if let Some((proto, addr)) = part.split_once('=') {
                let proto = proto.trim().to_lowercase();
                let addr = addr.trim();
                if proto == "http" || proto == "https" {
                    http_proxy = Some(format!("http://{}", addr));
                    break;
                } else if proto == "socks" {
                    socks_proxy = Some(format!("socks5://{}", addr));
                }
            }
        }
        return http_proxy.or(socks_proxy);
    }

    if raw.starts_with("http://")
        || raw.starts_with("https://")
        || raw.starts_with("socks5://")
        || raw.starts_with("socks5h://")
    {
        Some(raw.to_string())
    } else if raw.starts_with("socks://") {
        Some(raw.replacen("socks://", "socks5://", 1))
    } else {
        Some(format!("http://{}", raw))
    }
}

/// 扫描跨平台常见环境变量 (HTTP_PROXY / ALL_PROXY 等)
fn check_env_proxy() -> Option<String> {
    let env_keys = [
        "all_proxy",
        "ALL_PROXY",
        "https_proxy",
        "HTTPS_PROXY",
        "http_proxy",
        "HTTP_PROXY",
    ];
    for key in env_keys {
        if let Ok(val) = std::env::var(key) {
            if let Some(norm) = normalize_proxy_url(&val) {
                return Some(norm);
            }
        }
    }
    None
}

/// 跨平台获取操作系统系统代理 (Windows / macOS / Linux)
pub fn detect_system_proxy() -> SystemProxyInfo {
    // 1. 尝试使用操作系统原生注册表/命令读取
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(settings) = hkcu.open_subkey_with_flags(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            KEY_READ,
        ) {
            let enable = settings
                .get_value("ProxyEnable")
                .map(|val: u32| val == 1)
                .unwrap_or(false);
            if enable {
                if let Ok(server) = settings.get_value::<String, &str>("ProxyServer") {
                    if let Some(url) = normalize_proxy_url(&server) {
                        return SystemProxyInfo {
                            enabled: true,
                            url: Some(url),
                        };
                    }
                }
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        if let Ok(sys) = sysproxy::Sysproxy::get_system_proxy() {
            if sys.enable && !sys.host.is_empty() && sys.port > 0 {
                let url = format!("http://{}:{}", sys.host, sys.port);
                return SystemProxyInfo {
                    enabled: true,
                    url: Some(url),
                };
            }
        }
    }

    // 2. 操作系统级未启用或未探测到时，回退检查系统环境变量
    if let Some(env_url) = check_env_proxy() {
        return SystemProxyInfo {
            enabled: true,
            url: Some(env_url),
        };
    }

    SystemProxyInfo {
        enabled: false,
        url: None,
    }
}

#[tauri::command]
pub fn get_system_proxy() -> SystemProxyInfo {
    detect_system_proxy()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_system_proxy() {
        let proxy = detect_system_proxy();
        println!("Detected system proxy: {:?}", proxy);
    }

    #[test]
    fn test_normalize_proxy_url() {
        assert_eq!(
            normalize_proxy_url("127.0.0.1:7890"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            normalize_proxy_url("http=127.0.0.1:7890;https=127.0.0.1:7890"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            normalize_proxy_url("socks=127.0.0.1:10808"),
            Some("socks5://127.0.0.1:10808".to_string())
        );
        assert_eq!(
            normalize_proxy_url("socks5://127.0.0.1:10808"),
            Some("socks5://127.0.0.1:10808".to_string())
        );
    }
}
