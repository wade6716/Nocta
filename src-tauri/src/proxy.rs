// src-tauri/src/proxy.rs

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex as AsyncMutex;

const DEFAULT_HTTP_USER_AGENT: &str = concat!("Nocta/", env!("CARGO_PKG_VERSION"), " (Desktop; EmbyClient)");
const SYSTEM_PROXY_CACHE_TTL: Duration = Duration::from_secs(3);
const BRIDGE_IO_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SystemProxyInfo {
    pub enabled: bool,
    pub url: Option<String>,
    #[serde(default)]
    pub bypass: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeServerProxyEntry {
    pub mode: String,
    pub manual_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProxySyncPayload {
    pub mode: String,
    pub manual_url: Option<String>,
    pub default_user_agent: Option<String>,
    pub server_user_agents: Option<HashMap<String, String>>,
    pub server_proxies: Option<HashMap<String, RuntimeServerProxyEntry>>,
}

#[derive(Debug, Clone)]
struct RuntimeProxyState {
    mode: String,
    manual_url: Option<String>,
    default_user_agent: String,
    server_user_agents: Vec<(String, String)>,
    server_proxies: Vec<(String, RuntimeServerProxyEntry)>,
}

impl Default for RuntimeProxyState {
    fn default() -> Self {
        Self {
            mode: "system".to_string(),
            manual_url: None,
            default_user_agent: DEFAULT_HTTP_USER_AGENT.to_string(),
            server_user_agents: Vec::new(),
            server_proxies: Vec::new(),
        }
    }
}

static RUNTIME_PROXY_STATE: OnceLock<RwLock<RuntimeProxyState>> = OnceLock::new();
static SYSTEM_PROXY_CACHE: OnceLock<RwLock<Option<(Instant, SystemProxyInfo)>>> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedEmbyHostPayload {
    pub origin_url: String,
    pub observed_url: String,
    pub category: String,
}

pub fn init_app_handle(app_handle: &AppHandle) {
    let _ = APP_HANDLE.set(app_handle.clone());
}

pub fn emit_observed_emby_host(origin_url: &str, observed_url: &str, category: &str) {
    if !observed_url.starts_with("http://") && !observed_url.starts_with("https://") {
        return;
    }
    if let Some(app) = APP_HANDLE.get() {
        let payload = ObservedEmbyHostPayload {
            origin_url: origin_url.to_string(),
            observed_url: observed_url.to_string(),
            category: category.to_string(),
        };
        let _ = app.emit("emby-hosts-observed", payload);
    }
}

fn runtime_state() -> &'static RwLock<RuntimeProxyState> {
    RUNTIME_PROXY_STATE.get_or_init(|| RwLock::new(RuntimeProxyState::default()))
}

fn system_proxy_cache() -> &'static RwLock<Option<(Instant, SystemProxyInfo)>> {
    SYSTEM_PROXY_CACHE.get_or_init(|| RwLock::new(None))
}

fn normalize_server_prefix(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_ascii_lowercase()
}

/// 标准化代理字符串为完整的协议 URL (如 http://127.0.0.1:7890 或 socks5://127.0.0.1:10808)
pub fn normalize_proxy_url(raw: &str) -> Option<String> {
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
                if addr.is_empty() {
                    continue;
                }
                if proto == "http" || proto == "https" {
                    http_proxy = Some(format!("http://{addr}"));
                    break;
                } else if proto == "socks" || proto == "socks5" || proto == "socks5h" {
                    socks_proxy = Some(format!("socks5://{addr}"));
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
    } else if let Some(rest) = raw.strip_prefix("socks://") {
        Some(format!("socks5://{rest}"))
    } else {
        Some(format!("http://{raw}"))
    }
}

fn parse_bypass_rules(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ';' || c == ',' || c.is_whitespace())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

fn read_no_proxy_env() -> Vec<String> {
    for key in ["no_proxy", "NO_PROXY"] {
        if let Ok(val) = std::env::var(key) {
            let rules = parse_bypass_rules(&val);
            if !rules.is_empty() {
                return rules;
            }
        }
    }
    Vec::new()
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

#[cfg(target_os = "macos")]
fn detect_macos_scutil_proxy() -> Option<SystemProxyInfo> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);

    let mut socks_enabled = false;
    let mut socks_host = String::new();
    let mut socks_port: u16 = 0;
    let mut http_enabled = false;
    let mut http_host = String::new();
    let mut http_port: u16 = 0;
    let mut https_enabled = false;
    let mut https_host = String::new();
    let mut https_port: u16 = 0;
    let mut bypass = Vec::new();
    let mut in_exceptions = false;
    let mut exclude_simple_hostnames = false;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.starts_with("ExceptionsList") && line.contains("<array>") {
            in_exceptions = true;
            continue;
        }
        if in_exceptions {
            if line == "}" {
                in_exceptions = false;
                continue;
            }
            if let Some((_, val)) = line.split_once(':') {
                let v = val.trim();
                if !v.is_empty() && !bypass.iter().any(|existing| existing == v) {
                    bypass.push(v.to_string());
                }
            }
            continue;
        }

        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim();
        match key {
            "HTTPEnable" => http_enabled = val == "1",
            "HTTPProxy" => http_host = val.to_string(),
            "HTTPPort" => http_port = val.parse().unwrap_or(0),
            "HTTPSEnable" => https_enabled = val == "1",
            "HTTPSProxy" => https_host = val.to_string(),
            "HTTPSPort" => https_port = val.parse().unwrap_or(0),
            "SOCKSEnable" => socks_enabled = val == "1",
            "SOCKSProxy" => socks_host = val.to_string(),
            "SOCKSPort" => socks_port = val.parse().unwrap_or(0),
            "ExcludeSimpleHostnames" => exclude_simple_hostnames = val == "1",
            _ => {}
        }
    }

    if exclude_simple_hostnames && !bypass.iter().any(|r| r.eq_ignore_ascii_case("<local>")) {
        bypass.push("<local>".to_string());
    }

    let url = if http_enabled && !http_host.is_empty() && http_port > 0 {
        Some(format!("http://{http_host}:{http_port}"))
    } else if https_enabled && !https_host.is_empty() && https_port > 0 {
        Some(format!("http://{https_host}:{https_port}"))
    } else if socks_enabled && !socks_host.is_empty() && socks_port > 0 {
        Some(format!("socks5://{socks_host}:{socks_port}"))
    } else {
        None
    };

    Some(SystemProxyInfo {
        enabled: url.is_some(),
        url,
        bypass,
    })
}

/// 跨平台获取操作系统系统代理 (Windows / macOS / Linux)
pub fn detect_system_proxy() -> SystemProxyInfo {
    let mut bypass = read_no_proxy_env();

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
            if let Ok(override_raw) = settings.get_value::<String, &str>("ProxyOverride") {
                for rule in parse_bypass_rules(&override_raw) {
                    if !bypass.contains(&rule) {
                        bypass.push(rule);
                    }
                }
            }

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
                            bypass,
                        };
                    }
                }
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let mut sysproxy_url: Option<String> = None;
        if let Ok(sys) = sysproxy::Sysproxy::get_system_proxy() {
            for rule in parse_bypass_rules(&sys.bypass) {
                if !bypass.contains(&rule) {
                    bypass.push(rule);
                }
            }
            if sys.enable && !sys.host.is_empty() && sys.port > 0 {
                sysproxy_url = Some(format!("http://{}:{}", sys.host, sys.port));
            }
        }

        #[cfg(target_os = "macos")]
        let scutil_info = detect_macos_scutil_proxy();
        #[cfg(target_os = "macos")]
        if let Some(ref info) = scutil_info {
            for rule in &info.bypass {
                if !bypass.contains(rule) {
                    bypass.push(rule.clone());
                }
            }
        }

        if let Some(url) = sysproxy_url {
            return SystemProxyInfo {
                enabled: true,
                url: Some(url),
                bypass,
            };
        }

        #[cfg(target_os = "macos")]
        if let Some(info) = scutil_info {
            if info.enabled && info.url.is_some() {
                return SystemProxyInfo {
                    enabled: true,
                    url: info.url,
                    bypass,
                };
            }
        }
    }

    // 2. 操作系统级未启用或未探测到时，回退检查系统环境变量
    if let Some(env_url) = check_env_proxy() {
        return SystemProxyInfo {
            enabled: true,
            url: Some(env_url),
            bypass,
        };
    }

    SystemProxyInfo {
        enabled: false,
        url: None,
        bypass,
    }
}

pub fn detect_system_proxy_cached() -> SystemProxyInfo {
    if let Ok(guard) = system_proxy_cache().read() {
        if let Some((captured_at, ref info)) = *guard {
            if captured_at.elapsed() < SYSTEM_PROXY_CACHE_TTL {
                return info.clone();
            }
        }
    }

    let fresh = detect_system_proxy();
    if let Ok(mut guard) = system_proxy_cache().write() {
        *guard = Some((Instant::now(), fresh.clone()));
    }
    fresh
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star_idx: Option<usize> = None;
    let mut match_idx = 0usize;

    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_idx = Some(pi);
            match_idx = ti;
            pi += 1;
        } else if let Some(si) = star_idx {
            pi = si + 1;
            match_idx += 1;
            ti = match_idx;
        } else {
            return false;
        }
    }

    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

fn match_cidr(host_ip: Option<IpAddr>, addr_part: &str, prefix_part: &str) -> Option<bool> {
    let clean_addr = addr_part.trim().trim_matches(|c| c == '[' || c == ']');
    let net_ip = clean_addr.parse::<IpAddr>().ok()?;
    let prefix: u32 = prefix_part.trim().parse().ok()?;

    match net_ip {
        IpAddr::V4(net_v4) => {
            if prefix > 32 {
                return None;
            }
            let Some(IpAddr::V4(target_v4)) = host_ip else {
                return Some(false);
            };
            let mask: u32 = if prefix == 0 {
                0
            } else {
                !0u32 << (32 - prefix)
            };
            Some((u32::from(target_v4) & mask) == (u32::from(net_v4) & mask))
        }
        IpAddr::V6(net_v6) => {
            if prefix > 128 {
                return None;
            }
            let Some(IpAddr::V6(target_v6)) = host_ip else {
                return Some(false);
            };
            let mask: u128 = if prefix == 0 {
                0
            } else {
                !0u128 << (128 - prefix)
            };
            Some((u128::from(target_v6) & mask) == (u128::from(net_v6) & mask))
        }
    }
}

fn split_rule_host_port(rule: &str) -> (&str, Option<&str>) {
    if let Some(rest) = rule.strip_prefix('[') {
        if let Some((inner, after)) = rest.split_once(']') {
            if let Some(port_part) = after.strip_prefix(':') {
                return (inner, Some(port_part));
            }
            return (inner, None);
        }
    }

    if rule.matches(':').count() == 1 {
        if let Some((host_part, port_part)) = rule.split_once(':') {
            return (host_part, Some(port_part));
        }
    }

    (rule, None)
}

/// 严格依据操作系统「跳过代理」列表及 NO_PROXY 规则判断目标 URL 是否旁路代理
pub fn should_bypass_proxy(target_url: &str, bypass_rules: &[String]) -> bool {
    if bypass_rules.is_empty() {
        return false;
    }

    let Ok(parsed) = Url::parse(target_url) else {
        return false;
    };
    let Some(raw_host) = parsed.host_str() else {
        return false;
    };
    let scheme = parsed.scheme().to_ascii_lowercase();
    let host = raw_host
        .trim_matches(|c| c == '[' || c == ']')
        .to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    let host_ip = host.parse::<IpAddr>().ok();
    let port = parsed.port_or_known_default();

    for raw_rule in bypass_rules {
        let mut rule = raw_rule.trim().to_ascii_lowercase();
        if rule.is_empty() {
            continue;
        }

        if let Some(rest) = rule.strip_prefix("http://") {
            if scheme != "http" {
                continue;
            }
            rule = rest.to_string();
        } else if let Some(rest) = rule.strip_prefix("https://") {
            if scheme != "https" {
                continue;
            }
            rule = rest.to_string();
        }

        if rule == "*" {
            return true;
        }
        if rule == "<local>" {
            if !host.contains('.') {
                return true;
            }
            continue;
        }

        if let Some((addr_part, suffix_part)) = rule.split_once('/') {
            if let Some(matched) = match_cidr(host_ip, addr_part, suffix_part) {
                if matched {
                    return true;
                }
                continue;
            }
            rule = addr_part.to_string();
        }

        let (rule_host, rule_port) = split_rule_host_port(&rule);
        if let Some(rp) = rule_port {
            if !rp.is_empty() {
                let port_matched = port
                    .map(|p| glob_match(rp, &p.to_string()))
                    .unwrap_or(false);
                if !port_matched {
                    continue;
                }
            }
        }
        if rule_host.is_empty() {
            continue;
        }

        if let (Some(target_ip), Ok(rule_ip)) = (host_ip, rule_host.parse::<IpAddr>()) {
            if target_ip == rule_ip {
                return true;
            }
        }

        if let Some(suffix) = rule_host.strip_prefix('.') {
            if host == suffix || host.ends_with(rule_host) {
                return true;
            }
            continue;
        }

        if glob_match(rule_host, &host) {
            return true;
        }
    }

    false
}

#[tauri::command]
pub fn get_system_proxy() -> SystemProxyInfo {
    let fresh = detect_system_proxy();
    if let Ok(mut guard) = system_proxy_cache().write() {
        *guard = Some((Instant::now(), fresh.clone()));
    }
    fresh
}

#[tauri::command]
pub fn sync_runtime_proxy_config(config: RuntimeProxySyncPayload) -> Result<(), String> {
    let mut server_user_agents: Vec<(String, String)> = config
        .server_user_agents
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(k, v)| {
            let key = normalize_server_prefix(&k);
            let val = v.trim().to_string();
            if key.is_empty() || val.is_empty() {
                None
            } else {
                Some((key, val))
            }
        })
        .collect();
    server_user_agents.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    let mut server_proxies: Vec<(String, RuntimeServerProxyEntry)> = config
        .server_proxies
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(k, mut v)| {
            let key = normalize_server_prefix(&k);
            if key.is_empty() {
                None
            } else {
                v.manual_url = v.manual_url.as_deref().and_then(normalize_proxy_url);
                Some((key, v))
            }
        })
        .collect();
    server_proxies.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    let default_ua = config
        .default_user_agent
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_HTTP_USER_AGENT)
        .to_string();

    let next = RuntimeProxyState {
        mode: config.mode.trim().to_ascii_lowercase(),
        manual_url: config.manual_url.as_deref().and_then(normalize_proxy_url),
        default_user_agent: default_ua,
        server_user_agents,
        server_proxies,
    };

    let mut guard = runtime_state()
        .write()
        .map_err(|_| "RuntimeProxyState 锁异常".to_string())?;
    *guard = next;
    Ok(())
}

/// 解析运行时图片/后端请求的真实代理与 User-Agent
pub fn resolve_runtime_proxy_and_ua(target_url: &str) -> (Option<String>, String) {
    let normalized_target = target_url.trim().to_ascii_lowercase();
    let state = runtime_state()
        .read()
        .map(|g| g.clone())
        .unwrap_or_default();

    let ua = state
        .server_user_agents
        .iter()
        .find(|(prefix, _)| normalized_target.starts_with(prefix))
        .map(|(_, ua)| ua.clone())
        .unwrap_or_else(|| state.default_user_agent.clone());

    let (mode, manual_url) = state
        .server_proxies
        .iter()
        .find(|(prefix, _)| normalized_target.starts_with(prefix))
        .map(|(_, entry)| (entry.mode.as_str(), entry.manual_url.clone()))
        .unwrap_or((state.mode.as_str(), state.manual_url.clone()));

    let proxy = match mode {
        "direct" => None,
        "system" => {
            let sys = detect_system_proxy_cached();
            if sys.enabled && !should_bypass_proxy(target_url, &sys.bypass) {
                sys.url
            } else {
                None
            }
        }
        "manual" | "http" | "socks5" => {
            let sys = detect_system_proxy_cached();
            if should_bypass_proxy(target_url, &sys.bypass) {
                None
            } else {
                manual_url
            }
        }
        _ => None,
    };

    (proxy, ua)
}

// ================= 按需 L4 HTTP CONNECT -> SOCKS5 隧道桥 =================

#[derive(Default)]
struct Socks5BridgeState {
    upstream_socks_url: RwLock<Option<String>>,
    local_port: AsyncMutex<Option<u16>>,
}

static SOCKS5_BRIDGE: OnceLock<Socks5BridgeState> = OnceLock::new();

fn socks5_bridge() -> &'static Socks5BridgeState {
    SOCKS5_BRIDGE.get_or_init(Socks5BridgeState::default)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn validate_socks5_url(raw: &str) -> Result<String, String> {
    let normalized = normalize_proxy_url(raw).ok_or_else(|| "SOCKS5 代理地址不能为空".to_string())?;
    let parsed = Url::parse(&normalized).map_err(|e| format!("SOCKS5 代理格式无效: {e}"))?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "socks5" && scheme != "socks5h" {
        return Err(format!("仅支持 SOCKS5 协议，当前为: {scheme}"));
    }
    if parsed.host_str().is_none() {
        return Err("SOCKS5 代理缺少主机地址".to_string());
    }
    Ok(normalized)
}

#[tauri::command]
pub async fn ensure_socks5_http_bridge(socks_url: String) -> Result<String, String> {
    let normalized = validate_socks5_url(&socks_url)?;
    {
        let mut upstream_guard = socks5_bridge()
            .upstream_socks_url
            .write()
            .map_err(|_| "Socks5Bridge 锁异常".to_string())?;
        *upstream_guard = Some(normalized);
    }

    let mut port_guard = socks5_bridge().local_port.lock().await;
    if let Some(existing_port) = *port_guard {
        return Ok(format!("http://127.0.0.1:{existing_port}"));
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("无法启动本地 SOCKS5 隧道桥: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取本地 SOCKS5 隧道桥端口失败: {e}"))?
        .port();
    *port_guard = Some(port);

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tokio::spawn(async move {
                        let _ = handle_socks5_bridge_connection(stream).await;
                    });
                }
                Err(e) => {
                    eprintln!("[Nocta SOCKS5 Bridge Accept Error] {e}");
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });

    Ok(format!("http://127.0.0.1:{port}"))
}

async fn connect_via_socks5(
    socks_url: &str,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let parsed = Url::parse(socks_url).map_err(|e| format!("SOCKS5 URL 无效: {e}"))?;
    let proxy_host = parsed
        .host_str()
        .map(|h| h.trim_matches(|c| c == '[' || c == ']').to_string())
        .ok_or_else(|| "SOCKS5 缺少主机名".to_string())?;
    let proxy_port = parsed.port().unwrap_or(1080);

    let mut stream = tokio::time::timeout(
        BRIDGE_IO_TIMEOUT,
        TcpStream::connect((proxy_host.as_str(), proxy_port)),
    )
    .await
    .map_err(|_| "连接 SOCKS5 代理超时".to_string())?
    .map_err(|e| format!("连接 SOCKS5 代理失败: {e}"))?;
    let _ = stream.set_nodelay(true);

    let username = if parsed.username().is_empty() {
        None
    } else {
        Some(percent_decode(parsed.username()))
    };
    let password = parsed.password().map(percent_decode).unwrap_or_default();
    let has_auth = username.is_some();

    let greeting: &[u8] = if has_auth {
        &[0x05, 0x02, 0x00, 0x02]
    } else {
        &[0x05, 0x01, 0x00]
    };
    stream
        .write_all(greeting)
        .await
        .map_err(|e| format!("SOCKS5 握手发送失败: {e}"))?;

    let mut method_reply = [0u8; 2];
    tokio::time::timeout(BRIDGE_IO_TIMEOUT, stream.read_exact(&mut method_reply))
        .await
        .map_err(|_| "SOCKS5 握手超时".to_string())?
        .map_err(|e| format!("SOCKS5 握手读取失败: {e}"))?;

    if method_reply[0] != 0x05 {
        return Err(format!("非法的 SOCKS5 协议版本: {}", method_reply[0]));
    }

    match method_reply[1] {
        0x00 => {}
        0x02 => {
            let user = username.as_deref().unwrap_or("");
            let u_bytes = user.as_bytes();
            let p_bytes = password.as_bytes();
            if u_bytes.len() > 255 || p_bytes.len() > 255 {
                return Err("SOCKS5 用户名或密码过长".to_string());
            }
            let mut auth_req = Vec::with_capacity(3 + u_bytes.len() + p_bytes.len());
            auth_req.push(0x01);
            auth_req.push(u_bytes.len() as u8);
            auth_req.extend_from_slice(u_bytes);
            auth_req.push(p_bytes.len() as u8);
            auth_req.extend_from_slice(p_bytes);
            stream
                .write_all(&auth_req)
                .await
                .map_err(|e| format!("SOCKS5 鉴权发送失败: {e}"))?;

            let mut auth_reply = [0u8; 2];
            tokio::time::timeout(BRIDGE_IO_TIMEOUT, stream.read_exact(&mut auth_reply))
                .await
                .map_err(|_| "SOCKS5 鉴权超时".to_string())?
                .map_err(|e| format!("SOCKS5 鉴权读取失败: {e}"))?;
            if auth_reply[1] != 0x00 {
                return Err("SOCKS5 用户名或密码认证被拒绝".to_string());
            }
        }
        0xff => return Err("SOCKS5 服务器拒绝了所有可用认证方式".to_string()),
        other => return Err(format!("不支持的 SOCKS5 认证方式: {other}")),
    }

    let clean_host = target_host.trim_matches(|c| c == '[' || c == ']');
    let mut req = Vec::with_capacity(6 + clean_host.len());
    req.extend_from_slice(&[0x05, 0x01, 0x00]);
    if let Ok(ip) = clean_host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                req.push(0x01);
                req.extend_from_slice(&v4.octets());
            }
            IpAddr::V6(v6) => {
                req.push(0x04);
                req.extend_from_slice(&v6.octets());
            }
        }
    } else {
        let host_bytes = clean_host.as_bytes();
        if host_bytes.is_empty() || host_bytes.len() > 255 {
            return Err("目标域名长度无效".to_string());
        }
        req.push(0x03);
        req.push(host_bytes.len() as u8);
        req.extend_from_slice(host_bytes);
    }
    req.extend_from_slice(&target_port.to_be_bytes());

    stream
        .write_all(&req)
        .await
        .map_err(|e| format!("SOCKS5 CONNECT 请求发送失败: {e}"))?;

    let mut rep_hdr = [0u8; 4];
    tokio::time::timeout(BRIDGE_IO_TIMEOUT, stream.read_exact(&mut rep_hdr))
        .await
        .map_err(|_| "SOCKS5 CONNECT 响应超时".to_string())?
        .map_err(|e| format!("SOCKS5 CONNECT 响应读取失败: {e}"))?;

    if rep_hdr[0] != 0x05 {
        return Err("SOCKS5 响应版本异常".to_string());
    }
    if rep_hdr[1] != 0x00 {
        return Err(format!("SOCKS5 建连失败 (reply code {})", rep_hdr[1]));
    }

    // 读取并丢弃 BND.ADDR + BND.PORT，使流游标停留在干净的应用字节起点
    let tail_len = match rep_hdr[3] {
        0x01 => 4 + 2,
        0x04 => 16 + 2,
        0x03 => {
            let mut len_buf = [0u8; 1];
            stream
                .read_exact(&mut len_buf)
                .await
                .map_err(|e| format!("SOCKS5 BND 域名长度读取失败: {e}"))?;
            (len_buf[0] as usize) + 2
        }
        other => return Err(format!("SOCKS5 响应包含未知地址类型: {other}")),
    };
    let mut discard = vec![0u8; tail_len];
    stream
        .read_exact(&mut discard)
        .await
        .map_err(|e| format!("SOCKS5 BND 地址读取失败: {e}"))?;

    Ok(stream)
}

fn parse_connect_authority(target: &str) -> Option<(String, u16)> {
    let trimmed = target.trim();
    if let Some(rest) = trimmed.strip_prefix('[') {
        let (addr, port_part) = rest.split_once(']')?;
        let port = port_part
            .strip_prefix(':')
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(443);
        return Some((addr.to_string(), port));
    }
    if let Some((host, port_str)) = trimmed.rsplit_once(':') {
        if let Ok(port) = port_str.parse::<u16>() {
            return Some((host.to_string(), port));
        }
    }
    if trimmed.is_empty() {
        None
    } else {
        Some((trimmed.to_string(), 443))
    }
}

async fn handle_socks5_bridge_connection(stream: TcpStream) -> Result<(), ()> {
    let _ = stream.set_nodelay(true);
    let mut reader = BufReader::new(stream);

    let mut request_line = String::new();
    let Ok(Ok(n)) = tokio::time::timeout(BRIDGE_IO_TIMEOUT, reader.read_line(&mut request_line)).await else {
        return Ok(());
    };
    if n == 0 {
        return Ok(());
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let version = parts.next().unwrap_or("HTTP/1.1").to_string();

    let mut headers: Vec<(String, String)> = Vec::new();
    let mut total_header_bytes = request_line.len();
    let mut line = String::new();
    loop {
        line.clear();
        let Ok(Ok(read_n)) = tokio::time::timeout(BRIDGE_IO_TIMEOUT, reader.read_line(&mut line)).await else {
            return Ok(());
        };
        total_header_bytes += read_n;
        if read_n == 0 || total_header_bytes > 16 * 1024 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }

    let Some(socks_url) = socks5_bridge()
        .upstream_socks_url
        .read()
        .ok()
        .and_then(|g| g.clone())
    else {
        let mut client = reader.into_inner();
        let _ = client
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            .await;
        return Ok(());
    };

    if method.eq_ignore_ascii_case("CONNECT") {
        let Some((host, port)) = parse_connect_authority(&target) else {
            let mut client = reader.into_inner();
            let _ = client
                .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
                .await;
            return Ok(());
        };

        let Ok(mut upstream) = connect_via_socks5(&socks_url, &host, port).await else {
            let mut client = reader.into_inner();
            let _ = client
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
                .await;
            return Ok(());
        };

        let early_bytes = reader.buffer().to_vec();
        let mut client = reader.into_inner();
        if client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await
            .is_err()
        {
            return Ok(());
        }
        if !early_bytes.is_empty() && upstream.write_all(&early_bytes).await.is_err() {
            return Ok(());
        }
        let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
        return Ok(());
    }

    // 处理明文 HTTP 代理请求（如 http://example.com/path）
    let Ok(parsed_target) = Url::parse(&target) else {
        let mut client = reader.into_inner();
        let _ = client
            .write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            .await;
        return Ok(());
    };
    let Some(host) = parsed_target.host_str().map(|h| h.trim_matches(|c| c == '[' || c == ']').to_string()) else {
        return Ok(());
    };
    let port = parsed_target.port_or_known_default().unwrap_or(80);
    let mut path_and_query = parsed_target.path().to_string();
    if path_and_query.is_empty() {
        path_and_query.push('/');
    }
    if let Some(q) = parsed_target.query() {
        path_and_query.push('?');
        path_and_query.push_str(q);
    }

    let Ok(mut upstream) = connect_via_socks5(&socks_url, &host, port).await else {
        let mut client = reader.into_inner();
        let _ = client
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            .await;
        return Ok(());
    };

    let mut req_buf = format!("{method} {path_and_query} {version}\r\n");
    let mut has_host = false;
    for (k, v) in headers {
        let lower = k.to_ascii_lowercase();
        if lower == "proxy-connection" || lower == "proxy-authorization" {
            continue;
        }
        if lower == "host" {
            has_host = true;
        }
        req_buf.push_str(&format!("{k}: {v}\r\n"));
    }
    if !has_host {
        let host_hdr = if port == 80 {
            host
        } else {
            format!("{host}:{port}")
        };
        req_buf.push_str(&format!("Host: {host_hdr}\r\n"));
    }
    req_buf.push_str("\r\n");

    let early_bytes = reader.buffer().to_vec();
    let mut client = reader.into_inner();
    if upstream.write_all(req_buf.as_bytes()).await.is_err() {
        return Ok(());
    }
    if !early_bytes.is_empty() && upstream.write_all(&early_bytes).await.is_err() {
        return Ok(());
    }
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
    Ok(())
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

    #[test]
    fn test_should_bypass_proxy_rules() {
        // 1. 不得在应用内硬编码旁路任何私有网段或 .local（绕过列表为空时全部走代理）
        assert!(!should_bypass_proxy("http://127.0.0.1:8096/emby", &[]));
        assert!(!should_bypass_proxy("http://192.168.1.50:8096/emby", &[]));
        assert!(!should_bypass_proxy("http://10.0.0.5:8096", &[]));
        assert!(!should_bypass_proxy("http://172.20.1.8:8096", &[]));
        assert!(!should_bypass_proxy("http://nas.local:8096", &[]));

        // 2. 严格遵循操作系统跳过列表：例如列表中包含 10.* / 172.16-20.* 但未包含 192.168.*
        let windows_rules = vec![
            "<local>".to_string(),
            "localhost".to_string(),
            "127.*".to_string(),
            "10.*".to_string(),
            "172.16.*".to_string(),
            "172.20.*".to_string(),
        ];
        assert!(should_bypass_proxy("http://127.0.0.1:8096/emby", &windows_rules));
        assert!(should_bypass_proxy("http://localhost:8096/emby", &windows_rules));
        assert!(should_bypass_proxy("http://10.0.0.5:8096", &windows_rules));
        assert!(should_bypass_proxy("http://172.20.1.8:8096", &windows_rules));
        assert!(should_bypass_proxy("http://my-emby:8096", &windows_rules));
        assert!(!should_bypass_proxy("http://192.168.1.50:8096/emby", &windows_rules));
        assert!(!should_bypass_proxy("http://nas.local:8096", &windows_rules));

        // 3. 通配符、前导点后缀、端口匹配、协议前缀、IPv4/IPv6 CIDR 与方括号 IPv6
        let advanced_rules = vec![
            "*.corp.example".to_string(),
            ".suffix.example".to_string(),
            "nas.example.com:8096".to_string(),
            "http://192.168.1.*".to_string(),
            "192.168.0.0/16".to_string(),
            "172.16.0.0/12".to_string(),
            "10.0.0.0/8".to_string(),
            "[::1]:8096".to_string(),
            "fc00::/7".to_string(),
            "fe80::/10".to_string(),
        ];
        assert!(should_bypass_proxy("https://sub.corp.example/api", &advanced_rules));
        assert!(should_bypass_proxy("https://suffix.example/api", &advanced_rules));
        assert!(should_bypass_proxy("https://sub.suffix.example/api", &advanced_rules));
        assert!(!should_bypass_proxy("https://mysuffix.example/api", &advanced_rules));

        assert!(should_bypass_proxy("https://nas.example.com:8096/emby", &advanced_rules));
        assert!(!should_bypass_proxy("https://nas.example.com:443/emby", &advanced_rules));

        assert!(should_bypass_proxy("http://192.168.1.50:5005/dav", &advanced_rules));
        assert!(should_bypass_proxy("https://192.168.2.50:5006/dav", &advanced_rules));
        assert!(should_bypass_proxy("http://172.31.255.1:8096", &advanced_rules));
        assert!(!should_bypass_proxy("http://172.32.0.1:8096", &advanced_rules));

        assert!(should_bypass_proxy("http://[::1]:8096/emby", &advanced_rules));
        assert!(!should_bypass_proxy("http://[::1]:8097/emby", &advanced_rules));
        assert!(should_bypass_proxy("http://[fd12:3456:789a::1]:8096", &advanced_rules));
        assert!(should_bypass_proxy("http://[fe80::1]:8096", &advanced_rules));
        assert!(!should_bypass_proxy("https://emby.example.com/emby", &advanced_rules));

        // 4. scheme 精确限制与 0.0.0.0/0、::1/128、* 规则
        let scheme_only = vec!["http://192.168.1.*".to_string()];
        assert!(should_bypass_proxy("http://192.168.1.10/dav", &scheme_only));
        assert!(!should_bypass_proxy("https://192.168.1.10/dav", &scheme_only));

        assert!(should_bypass_proxy("https://any.example.com", &["*".to_string()]));
        assert!(should_bypass_proxy("https://1.2.3.4", &["0.0.0.0/0".to_string()]));
        assert!(should_bypass_proxy("http://[::1]/", &["::1/128".to_string()]));

        // 5. 多分隔符解析（分号 / 逗号 / 空格 / 换行）
        let parsed = parse_bypass_rules("<local>; localhost, 192.168.0.0/16\n10.0.0.0/8 127.*");
        assert_eq!(
            parsed,
            vec![
                "<local>",
                "localhost",
                "192.168.0.0/16",
                "10.0.0.0/8",
                "127.*"
            ]
        );
    }

    #[tokio::test]
    async fn test_socks5_http_bridge_connect_and_plain_http() {
        // 1. 启动一个最小化模拟目标 HTTP 服务
        let target_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target_port = target_listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = target_listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 512];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    if req.starts_with("PING") {
                        let _ = s.write_all(b"PONG").await;
                    } else {
                        let _ = s
                            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
                            .await;
                    }
                });
            }
        });

        // 2. 启动一个支持 RFC 1928 + RFC 1929 (user/pass) 的模拟 SOCKS5 服务器
        let socks_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let socks_port = socks_listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut client, _)) = socks_listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut hdr = [0u8; 2];
                    client.read_exact(&mut hdr).await.unwrap();
                    let nmethods = hdr[1] as usize;
                    let mut methods = vec![0u8; nmethods];
                    client.read_exact(&mut methods).await.unwrap();
                    assert!(methods.contains(&0x02));
                    client.write_all(&[0x05, 0x02]).await.unwrap();

                    // RFC 1929 auth
                    let mut ver = [0u8; 2];
                    client.read_exact(&mut ver).await.unwrap();
                    let mut u = vec![0u8; ver[1] as usize];
                    client.read_exact(&mut u).await.unwrap();
                    let mut plen = [0u8; 1];
                    client.read_exact(&mut plen).await.unwrap();
                    let mut p = vec![0u8; plen[0] as usize];
                    client.read_exact(&mut p).await.unwrap();
                    assert_eq!(String::from_utf8_lossy(&u), "alice");
                    assert_eq!(String::from_utf8_lossy(&p), "s@cret");
                    client.write_all(&[0x01, 0x00]).await.unwrap();

                    // CONNECT request
                    let mut req_hdr = [0u8; 4];
                    client.read_exact(&mut req_hdr).await.unwrap();
                    assert_eq!(req_hdr[1], 0x01);
                    let dest_host = match req_hdr[3] {
                        0x01 => {
                            let mut ip = [0u8; 4];
                            client.read_exact(&mut ip).await.unwrap();
                            std::net::Ipv4Addr::from(ip).to_string()
                        }
                        0x03 => {
                            let mut l = [0u8; 1];
                            client.read_exact(&mut l).await.unwrap();
                            let mut d = vec![0u8; l[0] as usize];
                            client.read_exact(&mut d).await.unwrap();
                            String::from_utf8(d).unwrap()
                        }
                        _ => panic!("unexpected atyp"),
                    };
                    let mut port_buf = [0u8; 2];
                    client.read_exact(&mut port_buf).await.unwrap();
                    let dest_port = u16::from_be_bytes(port_buf);

                    let mut upstream = TcpStream::connect((dest_host.as_str(), dest_port))
                        .await
                        .unwrap();
                    client
                        .write_all(&[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0])
                        .await
                        .unwrap();
                    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
                });
            }
        });

        let bridge_url = ensure_socks5_http_bridge(format!(
            "socks5://alice:s%40cret@127.0.0.1:{socks_port}"
        ))
        .await
        .unwrap();
        let bridge_addr = bridge_url.strip_prefix("http://").unwrap();

        // 测试 A: CONNECT 隧道 (TLS/HTTPS 流量场景)
        let mut conn = TcpStream::connect(bridge_addr).await.unwrap();
        let connect_req = format!("CONNECT 127.0.0.1:{target_port} HTTP/1.1\r\nHost: 127.0.0.1:{target_port}\r\n\r\n");
        conn.write_all(connect_req.as_bytes()).await.unwrap();

        let mut resp_reader = BufReader::new(conn);
        let mut status_line = String::new();
        resp_reader.read_line(&mut status_line).await.unwrap();
        assert!(status_line.contains("200"));
        let mut blank = String::new();
        resp_reader.read_line(&mut blank).await.unwrap();

        let mut tunneled = resp_reader.into_inner();
        tunneled.write_all(b"PING").await.unwrap();
        let mut pong = [0u8; 4];
        tunneled.read_exact(&mut pong).await.unwrap();
        assert_eq!(&pong, b"PONG");

        // 测试 B: 明文 HTTP 代理转发
        let mut plain_conn = TcpStream::connect(bridge_addr).await.unwrap();
        let get_req = format!(
            "GET http://127.0.0.1:{target_port}/hello HTTP/1.1\r\nProxy-Connection: keep-alive\r\n\r\n"
        );
        plain_conn.write_all(get_req.as_bytes()).await.unwrap();
        let mut plain_resp = String::new();
        plain_conn.read_to_string(&mut plain_resp).await.unwrap();
        assert!(plain_resp.contains("200 OK"));
        assert!(plain_resp.ends_with("OK"));
    }
}
