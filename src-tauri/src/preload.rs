use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE,
    CONTENT_TYPE, LOCATION, RANGE, SERVER,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

const CHUNK_SIZE: usize = 1024 * 1024; // 1 MiB 内存分块，避免大块连续内存 realloc 抖动
const HEAD_WARMUP_BYTES: u64 = 4 * 1024 * 1024; // 4 MiB 容器头探测/轨道区
const TAIL_INDEX_BYTES: u64 = 4 * 1024 * 1024; // 4 MiB 容器尾索引 (MKV Cues / MP4 moov)
const SMALL_FULL_FILE_THRESHOLD: u64 = 16 * 1024 * 1024; // 16 MiB 以下文件直接整文件拉取
const PROXY_READ_SLICE_BYTES: usize = 64 * 1024; // 64 KiB 回环切片读取粒度
const MAX_STREAM_REDIRECTS: usize = 6;
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnoseStreamRequest {
    pub url: String,
    pub proxy_url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticHopDto {
    pub hop: usize,
    pub url: String,
    pub status: Option<u16>,
    pub status_text: Option<String>,
    pub location: Option<String>,
    pub server: Option<String>,
    pub content_type: Option<String>,
    pub content_range: Option<String>,
    pub accept_ranges: Option<String>,
    pub cf_ray: Option<String>,
    pub cf_mitigated: Option<String>,
    pub body_snippet: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamDiagnosticReport {
    pub reachable: bool,
    pub final_status: Option<u16>,
    pub user_agent: String,
    pub summary: String,
    pub hops: Vec<DiagnosticHopDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRelayRequest {
    pub url: String,
    pub proxy_url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedRelayDto {
    pub token: String,
    pub local_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPreloadRequest {
    pub item_id: String,
    pub item_name: String,
    pub episode_number: Option<u32>,
    pub url: String,
    pub duration_sec: f64,
    pub start_sec: f64,
    pub preload_duration_sec: f64,
    pub max_memory_bytes: u64,
    pub bitrate_bps: Option<u64>,
    pub proxy_url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreloadStatusDto {
    pub token: String,
    pub item_id: String,
    pub item_name: String,
    pub episode_number: Option<u32>,
    pub status: String,
    pub total_size: u64,
    pub target_bytes: u64,
    pub cached_bytes: u64,
    pub target_duration_sec: f64,
    pub cached_duration_sec: f64,
    pub start_seconds: f64,
    pub skipped_intro: bool,
    pub capped_by_memory: bool,
    pub memory_released: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivatedPreloadDto {
    pub local_url: String,
    pub status: PreloadStatusDto,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreloadPlan {
    pub ranges: Vec<(u64, u64)>,
    pub target_bytes: u64,
    pub target_body_bytes: u64,
    pub body_range: Option<(u64, u64)>,
    pub bytes_per_sec: f64,
    pub effective_duration_sec: f64,
    pub skipped_intro: bool,
    pub capped_by_memory: bool,
}

/// 纯内存 1 MiB 分块区间存储（零磁盘 IO）。
#[derive(Debug, Default)]
struct MemExtent {
    start: u64,
    len: u64,
    chunks: Vec<Vec<u8>>,
}

impl MemExtent {
    fn new(start: u64) -> Self {
        Self {
            start,
            len: 0,
            chunks: Vec::new(),
        }
    }

    fn end(&self) -> u64 {
        self.start + self.len
    }

    fn append(&mut self, mut data: &[u8]) {
        while !data.is_empty() {
            if let Some(last) = self.chunks.last_mut() {
                let avail = CHUNK_SIZE.saturating_sub(last.len());
                if avail > 0 {
                    let take = avail.min(data.len());
                    last.extend_from_slice(&data[..take]);
                    self.len += take as u64;
                    data = &data[take..];
                    continue;
                }
            }
            let take = CHUNK_SIZE.min(data.len());
            let mut next_chunk = Vec::with_capacity(CHUNK_SIZE.min(data.len().max(64 * 1024)));
            next_chunk.extend_from_slice(&data[..take]);
            self.chunks.push(next_chunk);
            self.len += take as u64;
            data = &data[take..];
        }
    }

    fn read_slice(&self, offset: u64, max_len: usize) -> Vec<u8> {
        if offset < self.start || offset >= self.end() || max_len == 0 {
            return Vec::new();
        }
        let avail = (self.end() - offset).min(max_len as u64) as usize;
        let mut out = Vec::with_capacity(avail);
        let mut rel = (offset - self.start) as usize;
        let mut remaining = avail;

        while remaining > 0 {
            let chunk_idx = rel / CHUNK_SIZE;
            let chunk_off = rel % CHUNK_SIZE;
            let Some(chunk) = self.chunks.get(chunk_idx) else {
                break;
            };
            if chunk_off >= chunk.len() {
                break;
            }
            let take = (chunk.len() - chunk_off).min(remaining);
            out.extend_from_slice(&chunk[chunk_off..chunk_off + take]);
            rel += take;
            remaining -= take;
        }
        out
    }
}

#[derive(Debug, Default)]
struct ExtentStore {
    extents: Vec<MemExtent>,
    total_bytes: u64,
}

impl ExtentStore {
    fn write_at(&mut self, mut offset: u64, mut data: &[u8]) {
        while !data.is_empty() {
            // 1. 若当前 offset 已落在某个已有区间内，跳过已覆盖前缀
            if let Some(overlap) = self
                .extents
                .iter()
                .find(|e| offset >= e.start && offset < e.end())
            {
                let skip = (overlap.end() - offset).min(data.len() as u64) as usize;
                offset += skip as u64;
                data = &data[skip..];
                continue;
            }

            // 2. 找出紧随 offset 之后的区间，截断避免产生重叠
            let next_start = self
                .extents
                .iter()
                .filter(|e| e.start > offset)
                .map(|e| e.start)
                .min();
            let write_len = match next_start {
                Some(ns) => ((ns - offset).min(data.len() as u64)) as usize,
                None => data.len(),
            };
            if write_len == 0 {
                break;
            }

            let slice = &data[..write_len];

            // 3. 若恰好紧贴前一个区间末尾，直接追加，减少碎片并消除 realloc
            if let Some(prev) = self.extents.iter_mut().find(|e| e.end() == offset) {
                prev.append(slice);
            } else {
                let mut ext = MemExtent::new(offset);
                ext.append(slice);
                self.extents.push(ext);
                self.extents.sort_by_key(|e| e.start);
            }

            self.total_bytes += write_len as u64;
            offset += write_len as u64;
            data = &data[write_len..];
        }
    }

    fn read_cached_prefix(&self, offset: u64, max_len: usize) -> Option<Vec<u8>> {
        let ext = self
            .extents
            .iter()
            .find(|e| offset >= e.start && offset < e.end())?;
        let data = ext.read_slice(offset, max_len);
        if data.is_empty() {
            None
        } else {
            Some(data)
        }
    }

    fn next_cached_start_after(&self, offset: u64, limit_end_exclusive: u64) -> Option<u64> {
        self.extents
            .iter()
            .filter(|e| e.start > offset && e.start < limit_end_exclusive)
            .map(|e| e.start)
            .min()
    }

    fn cached_bytes_in_range(&self, start: u64, end: u64) -> u64 {
        if end <= start {
            return 0;
        }
        let mut sum = 0u64;
        for ext in &self.extents {
            let s = ext.start.max(start);
            let e = ext.end().min(end);
            if e > s {
                sum += e - s;
            }
        }
        sum
    }

    fn total_cached_bytes(&self) -> u64 {
        self.total_bytes
    }

    fn clear_and_shrink(&mut self) {
        self.extents.clear();
        self.extents.shrink_to_fit();
        self.total_bytes = 0;
    }
}

/// 按目标时长与片头跳过偏移规划纯内存预加载字节区间。
pub fn plan_preload_ranges_by_duration(
    total_size: u64,
    duration_sec: f64,
    start_sec: f64,
    preload_duration_sec: f64,
    max_memory_bytes: u64,
    fallback_bitrate_bps: Option<u64>,
) -> PreloadPlan {
    let mem_cap = max_memory_bytes.max(64 * 1024 * 1024);
    let safe_start = if start_sec.is_finite() && start_sec > 0.0 {
        start_sec
    } else {
        0.0
    };
    let effective_duration_sec = if duration_sec.is_finite() && duration_sec > 0.0 {
        preload_duration_sec
            .max(1.0)
            .min((duration_sec - safe_start).max(0.0))
    } else {
        preload_duration_sec.max(1.0)
    };

    let bytes_per_sec = if total_size > 0 && duration_sec.is_finite() && duration_sec > 1.0 {
        (total_size as f64) / duration_sec
    } else if fallback_bitrate_bps.unwrap_or(0) > 0 {
        (fallback_bitrate_bps.unwrap() as f64) / 8.0
    } else {
        1.5 * 1024.0 * 1024.0 // 兜底按 12 Mbps 估算
    };

    // 预留 15% VBR 码率波动余量
    let raw_body_bytes = (bytes_per_sec * effective_duration_sec * 1.15).ceil() as u64;
    let skipped_intro = safe_start > 5.0 && duration_sec > safe_start + 1.0;

    if total_size == 0 {
        return PreloadPlan {
            ranges: Vec::new(),
            target_bytes: 0,
            target_body_bytes: 0,
            body_range: None,
            bytes_per_sec,
            effective_duration_sec,
            skipped_intro,
            capped_by_memory: false,
        };
    }

    // 小文件且不超过内存上限时直接单段拉取完整文件，零额外请求开销
    if total_size <= SMALL_FULL_FILE_THRESHOLD && total_size <= mem_cap {
        return PreloadPlan {
            ranges: vec![(0, total_size)],
            target_bytes: total_size,
            target_body_bytes: total_size,
            body_range: Some((0, total_size)),
            bytes_per_sec,
            effective_duration_sec,
            skipped_intro,
            capped_by_memory: false,
        };
    }

    let head_end = HEAD_WARMUP_BYTES.min(total_size);
    let tail_start = total_size.saturating_sub(TAIL_INDEX_BYTES).max(head_end);
    let tail_end = total_size;
    let overhead = head_end + (tail_end - tail_start);

    let max_body_budget = mem_cap.saturating_sub(overhead);
    let (body_budget, capped_by_memory) = if raw_body_bytes > max_body_budget {
        (max_body_budget, true)
    } else {
        (raw_body_bytes, false)
    };

    let body_start = if skipped_intro {
        let est_offset = ((total_size as f64) * (safe_start / duration_sec)).floor() as u64;
        // 向前预留约 12 秒 VBR 安全余量，防止剧集片头码率偏高导致起播关键帧落在偏移前
        let lead_margin = ((bytes_per_sec * 12.0).round() as u64)
            .clamp(4 * 1024 * 1024, 24 * 1024 * 1024);
        est_offset
            .saturating_sub(lead_margin)
            .clamp(head_end, tail_start)
    } else {
        head_end
    };

    let body_end = body_start.saturating_add(body_budget).min(tail_start);

    let mut ranges = Vec::with_capacity(3);
    if head_end > 0 {
        ranges.push((0, head_end));
    }
    if tail_end > tail_start {
        ranges.push((tail_start, tail_end));
    }
    let body_range = if body_end > body_start {
        ranges.push((body_start, body_end));
        Some((body_start, body_end))
    } else {
        None
    };

    let target_body_bytes = body_range.map(|(s, e)| e - s).unwrap_or(0);
    let target_bytes = ranges.iter().map(|(s, e)| e - s).sum();

    PreloadPlan {
        ranges,
        target_bytes,
        target_body_bytes,
        body_range,
        bytes_per_sec,
        effective_duration_sec,
        skipped_intro,
        capped_by_memory,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeParseResult {
    None,
    Satisfiable(u64, u64),
    Unsatisfiable,
}

/// 解析 HTTP `Range: bytes=...` 请求头。
pub fn parse_http_range(range_header: Option<&str>, total_size: u64) -> RangeParseResult {
    let Some(raw) = range_header else {
        return RangeParseResult::None;
    };
    let trimmed = raw.trim();
    if !trimmed.to_ascii_lowercase().starts_with("bytes=") {
        return RangeParseResult::None;
    }
    let spec = trimmed[6..].trim();
    // 仅处理单一连续 Range；若多段 Range 则回退 200
    if spec.contains(',') || spec.is_empty() {
        return RangeParseResult::None;
    }
    let Some((start_str, end_str)) = spec.split_once('-') else {
        return RangeParseResult::Unsatisfiable;
    };

    if total_size == 0 {
        return RangeParseResult::Unsatisfiable;
    }

    if start_str.is_empty() {
        // 后缀长度: bytes=-N
        let Ok(suffix) = end_str.trim().parse::<u64>() else {
            return RangeParseResult::Unsatisfiable;
        };
        if suffix == 0 {
            return RangeParseResult::Unsatisfiable;
        }
        let start = total_size.saturating_sub(suffix);
        return RangeParseResult::Satisfiable(start, total_size - 1);
    }

    let Ok(start) = start_str.trim().parse::<u64>() else {
        return RangeParseResult::Unsatisfiable;
    };
    if start >= total_size {
        return RangeParseResult::Unsatisfiable;
    }

    if end_str.trim().is_empty() {
        return RangeParseResult::Satisfiable(start, total_size - 1);
    }

    let Ok(raw_end) = end_str.trim().parse::<u64>() else {
        return RangeParseResult::Unsatisfiable;
    };
    if raw_end < start {
        return RangeParseResult::Unsatisfiable;
    }

    RangeParseResult::Satisfiable(start, raw_end.min(total_size - 1))
}

struct SessionRuntime {
    status: String,
    error: Option<String>,
    total_size: u64,
    target_bytes: u64,
    target_body_bytes: u64,
    body_range: Option<(u64, u64)>,
    bytes_per_sec: f64,
    effective_duration_sec: f64,
    capped_by_memory: bool,
    skipped_intro: bool,
    content_type: String,
    memory_released: bool,
    extents: ExtentStore,
}

impl SessionRuntime {
    fn new(skipped_intro: bool, target_duration_sec: f64) -> Self {
        Self {
            status: "probing".to_string(),
            error: None,
            total_size: 0,
            target_bytes: 0,
            target_body_bytes: 0,
            body_range: None,
            bytes_per_sec: 0.0,
            effective_duration_sec: target_duration_sec,
            capped_by_memory: false,
            skipped_intro,
            content_type: "video/x-matroska".to_string(),
            memory_released: false,
            extents: ExtentStore::default(),
        }
    }
}

struct PreloadSession {
    token: String,
    item_id: String,
    item_name: String,
    episode_number: Option<u32>,
    upstream_url: String,
    client: reqwest::Client,
    headers: HeaderMap,
    start_seconds: f64,
    duration_seconds: f64,
    target_duration_seconds: f64,
    max_memory_bytes: u64,
    fallback_bitrate_bps: Option<u64>,
    cancelled: AtomicBool,
    abort_handle: std::sync::Mutex<Option<tokio::task::AbortHandle>>,
    runtime: RwLock<SessionRuntime>,
}

impl PreloadSession {
    fn cancel_download(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.abort_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
            }
        }
    }

    fn release_memory(&self) {
        self.cancel_download();
        if let Ok(mut rt) = self.runtime.write() {
            rt.extents.clear_and_shrink();
            rt.memory_released = true;
            if rt.status == "active" || rt.status == "ready" || rt.status == "downloading" {
                rt.status = "released".to_string();
            }
        }
    }

    fn destroy_all(&self) {
        self.cancel_download();
        if let Ok(mut rt) = self.runtime.write() {
            rt.extents.clear_and_shrink();
            rt.memory_released = true;
            rt.status = "cancelled".to_string();
        }
    }

    fn to_dto(&self) -> PreloadStatusDto {
        let rt = self.runtime.read().unwrap();
        let cached_bytes = rt.extents.total_cached_bytes();

        let cached_duration_sec = if rt.memory_released {
            0.0
        } else if rt.target_duration_sec_override(self.target_duration_seconds) <= 0.0 {
            0.0
        } else if let Some((b_start, b_end)) = rt.body_range {
            if rt.target_body_bytes > 0 {
                let body_cached = rt.extents.cached_bytes_in_range(b_start, b_end);
                (rt.effective_duration_sec * (body_cached as f64 / rt.target_body_bytes as f64))
                    .min(rt.effective_duration_sec)
            } else {
                0.0
            }
        } else if rt.bytes_per_sec > 0.0 && rt.target_bytes > 0 {
            (rt.effective_duration_sec * (cached_bytes as f64 / rt.target_bytes as f64))
                .min(rt.effective_duration_sec)
        } else {
            0.0
        };

        PreloadStatusDto {
            token: self.token.clone(),
            item_id: self.item_id.clone(),
            item_name: self.item_name.clone(),
            episode_number: self.episode_number,
            status: rt.status.clone(),
            total_size: rt.total_size,
            target_bytes: rt.target_bytes,
            cached_bytes,
            target_duration_sec: rt.target_duration_sec_override(self.target_duration_seconds),
            cached_duration_sec,
            start_seconds: self.start_seconds,
            skipped_intro: rt.skipped_intro,
            capped_by_memory: rt.capped_by_memory,
            memory_released: rt.memory_released,
            error: rt.error.clone(),
        }
    }
}

impl SessionRuntime {
    fn target_duration_sec_override(&self, req_duration: f64) -> f64 {
        if self.effective_duration_sec > 0.0 {
            self.effective_duration_sec
        } else {
            req_duration
        }
    }
}

struct RelaySession {
    token: String,
    upstream_url: String,
    client: reqwest::Client,
    headers: HeaderMap,
}

#[derive(Default)]
struct ManagerInner {
    pending: Option<Arc<PreloadSession>>,
    active: Option<Arc<PreloadSession>>,
    relay: Option<Arc<RelaySession>>,
    server_port: Option<u16>,
}

struct PreloadManager {
    inner: RwLock<ManagerInner>,
}

static PRELOAD_MANAGER: OnceLock<PreloadManager> = OnceLock::new();

fn manager() -> &'static PreloadManager {
    PRELOAD_MANAGER.get_or_init(|| PreloadManager {
        inner: RwLock::new(ManagerInner::default()),
    })
}

fn find_relay_by_token(token: &str) -> Option<Arc<RelaySession>> {
    let guard = manager().inner.read().ok()?;
    guard
        .relay
        .as_ref()
        .filter(|r| r.token == token)
        .cloned()
}

fn find_session_by_token(token: &str) -> Option<Arc<PreloadSession>> {
    let guard = manager().inner.read().ok()?;
    if let Some(ref act) = guard.active {
        if act.token == token {
            return Some(act.clone());
        }
    }
    if let Some(ref pend) = guard.pending {
        if pend.token == token {
            return Some(pend.clone());
        }
    }
    None
}

async fn ensure_proxy_server_started() -> Result<u16, String> {
    if let Ok(guard) = manager().inner.read() {
        if let Some(port) = guard.server_port {
            return Ok(port);
        }
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("无法启动本机预加载代理端口: {e}"))?;
    let local_addr: SocketAddr = listener
        .local_addr()
        .map_err(|e| format!("获取本机预加载代理端口失败: {e}"))?;
    let port = local_addr.port();

    {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        if let Some(existing_port) = guard.server_port {
            drop(listener);
            return Ok(existing_port);
        }
        guard.server_port = Some(port);
    }

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _peer)) => {
                    tokio::spawn(async move {
                        let _ = handle_proxy_connection(stream).await;
                    });
                }
                Err(e) => {
                    eprintln!("[Preload Proxy Accept Error] {e}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    });

    Ok(port)
}

async fn handle_proxy_connection(mut stream: TcpStream) -> Result<(), ()> {
    let _ = stream.set_nodelay(true);
    let mut reader = BufReader::new(&mut stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await.unwrap_or(0) == 0 {
        return Ok(());
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("");

    let mut range_header: Option<String> = None;
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).await.unwrap_or(0);
        if n == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range_header = Some(v.trim().to_string());
            }
        }
    }

    if !method.eq_ignore_ascii_case("GET") && !method.eq_ignore_ascii_case("HEAD") {
        let resp = "HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(());
    }

    let path = raw_path.split('?').next().unwrap_or(raw_path);
    if let Some(relay_token) = path.strip_prefix("/relay/") {
        return handle_relay_connection(stream, method, relay_token, range_header).await;
    }

    let token = path.strip_prefix("/stream/").unwrap_or("");
    let Some(session) = find_session_by_token(token) else {
        let resp = "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(());
    };

    let (total_size, content_type) = {
        let rt = session.runtime.read().map_err(|_| ())?;
        (rt.total_size, rt.content_type.clone())
    };

    if total_size == 0 {
        let resp = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(());
    }

    let is_head = method.eq_ignore_ascii_case("HEAD");
    let (status_line, req_start, req_end, content_range_hdr) =
        match parse_http_range(range_header.as_deref(), total_size) {
            RangeParseResult::None => (
                "HTTP/1.1 200 OK",
                0,
                total_size - 1,
                None,
            ),
            RangeParseResult::Satisfiable(s, e) => (
                "HTTP/1.1 206 Partial Content",
                s,
                e,
                Some(format!("Content-Range: bytes {s}-{e}/{total_size}\r\n")),
            ),
            RangeParseResult::Unsatisfiable => {
                let resp = format!(
                    "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total_size}\r\nAccept-Ranges: bytes\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                return Ok(());
            }
        };

    let content_len = req_end - req_start + 1;
    let mut header_buf = format!(
        "{status_line}\r\nContent-Type: {content_type}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {content_len}\r\nConnection: close\r\n"
    );
    if let Some(cr) = content_range_hdr {
        header_buf.push_str(&cr);
    }
    header_buf.push_str("\r\n");

    if stream.write_all(header_buf.as_bytes()).await.is_err() {
        return Ok(());
    }

    if is_head {
        return Ok(());
    }

    let mut cursor = req_start;
    while cursor <= req_end {
        let remaining = (req_end - cursor + 1) as usize;
        let read_max = remaining.min(PROXY_READ_SLICE_BYTES);

        // 严格不在持锁状态下执行 .await
        enum SliceAction {
            Cached(Vec<u8>),
            GapTo(u64),
        }

        let action = {
            let rt = session.runtime.read().map_err(|_| ())?;
            if let Some(bytes) = rt.extents.read_cached_prefix(cursor, read_max) {
                SliceAction::Cached(bytes)
            } else {
                let next_start = rt.extents.next_cached_start_after(cursor, req_end + 1);
                let gap_end = next_start.map(|s| s - 1).unwrap_or(req_end);
                SliceAction::GapTo(gap_end)
            }
        };

        match action {
            SliceAction::Cached(bytes) => {
                let len = bytes.len() as u64;
                if stream.write_all(&bytes).await.is_err() {
                    return Ok(());
                }
                cursor += len;
            }
            SliceAction::GapTo(gap_end) => {
                let range_val = format!("bytes={cursor}-{gap_end}");
                let mut req = session.client.get(&session.upstream_url).header(RANGE, range_val);
                for (k, v) in session.headers.iter() {
                    req = req.header(k, v);
                }

                let Ok(mut resp) = req.send().await else {
                    return Ok(());
                };
                if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT
                {
                    return Ok(());
                }

                let expected_gap = gap_end - cursor + 1;
                let mut sent_gap = 0u64;
                while sent_gap < expected_gap {
                    match resp.chunk().await {
                        Ok(Some(chunk)) => {
                            let need = (expected_gap - sent_gap) as usize;
                            let slice = if chunk.len() > need {
                                &chunk[..need]
                            } else {
                                &chunk[..]
                            };
                            if slice.is_empty() {
                                break;
                            }
                            if stream.write_all(slice).await.is_err() {
                                // 播放器断连（切集或 Seek）时立即中止上游拉流
                                return Ok(());
                            }
                            let written = slice.len() as u64;
                            sent_gap += written;
                            cursor += written;
                        }
                        Ok(None) => break,
                        Err(_) => return Ok(()),
                    }
                }

                if sent_gap == 0 {
                    break;
                }
            }
        }
    }

    let _ = stream.flush().await;
    Ok(())
}

fn parse_request_headers(raw_headers: Option<HashMap<String, String>>) -> (String, HeaderMap) {
    let mut user_agent: Option<String> = None;
    let mut header_map = HeaderMap::new();

    if let Some(headers) = raw_headers {
        for (raw_key, raw_val) in headers {
            let key_lower = raw_key.trim().to_ascii_lowercase();
            let val_trimmed = raw_val.trim();
            if key_lower.is_empty() || val_trimmed.is_empty() {
                continue;
            }
            if key_lower == "user-agent" {
                user_agent = Some(val_trimmed.to_string());
                continue;
            }
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(key_lower.as_bytes()),
                HeaderValue::from_str(val_trimmed),
            ) {
                header_map.insert(name, val);
            }
        }
    }

    (
        user_agent.unwrap_or_else(|| DEFAULT_USER_AGENT.to_string()),
        header_map,
    )
}

fn is_secret_query_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "api_key"
            | "x-emby-token"
            | "token"
            | "auth"
            | "signature"
            | "sig"
            | "sign"
            | "x-amz-signature"
    )
}

fn redact_url_secrets(raw: &str) -> String {
    let Ok(parsed) = Url::parse(raw) else {
        return raw.to_string();
    };
    if !parsed.query_pairs().any(|(k, _)| is_secret_query_key(&k)) {
        return raw.to_string();
    }

    let mut base = parsed.clone();
    base.set_query(None);
    base.set_fragment(None);

    let mut query_parts = Vec::new();
    for (k, v) in parsed.query_pairs() {
        let mut tmp = base.clone();
        if is_secret_query_key(&k) {
            tmp.query_pairs_mut().append_pair(&k, "");
            if let Some(q) = tmp.query() {
                query_parts.push(format!("{q}***"));
            }
        } else {
            tmp.query_pairs_mut().append_pair(&k, &v);
            if let Some(q) = tmp.query() {
                query_parts.push(q.to_string());
            }
        }
    }

    let mut result: String = base.into();
    if !query_parts.is_empty() {
        result.push('?');
        result.push_str(&query_parts.join("&"));
    }
    if let Some(frag) = parsed.fragment() {
        result.push('#');
        result.push_str(frag);
    }
    result
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme().eq_ignore_ascii_case(b.scheme())
        && a.host_str()
            .zip(b.host_str())
            .map(|(ha, hb)| ha.eq_ignore_ascii_case(hb))
            .unwrap_or(false)
        && a.port_or_known_default() == b.port_or_known_default()
}

fn build_no_redirect_http_client(
    proxy_url: Option<&str>,
    user_agent: &str,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(user_agent)
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30));

    if let Some(px) = proxy_url
        .map(str::trim)
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
    {
        let proxy = reqwest::Proxy::all(px).map_err(|e| format!("代理地址无效 ({px}): {e}"))?;
        builder = builder.proxy(proxy);
    } else {
        builder = builder.no_proxy();
    }

    builder
        .build()
        .map_err(|e| format!("创建 HTTP 诊断/中转客户端失败: {e}"))
}

fn apply_origin_safe_headers(
    mut req: reqwest::RequestBuilder,
    base_headers: &HeaderMap,
    is_same_origin: bool,
) -> reqwest::RequestBuilder {
    for (k, v) in base_headers.iter() {
        let lower = k.as_str().to_ascii_lowercase();
        if !is_same_origin && (lower == "authorization" || lower.starts_with("x-emby-")) {
            continue;
        }
        req = req.header(k, v);
    }
    req
}

async fn send_with_safe_redirects(
    client: &reqwest::Client,
    start_url: &str,
    base_headers: &HeaderMap,
    range_header: Option<&str>,
    is_head: bool,
) -> Result<(reqwest::Response, String), String> {
    let origin_url = Url::parse(start_url).map_err(|e| format!("流地址格式无效: {e}"))?;
    let mut current_url = origin_url.clone();

    for step in 0..=MAX_STREAM_REDIRECTS {
        let mut req = if is_head {
            client.head(current_url.as_str())
        } else {
            client.get(current_url.as_str())
        };
        let is_same = same_origin(&origin_url, &current_url);
        req = apply_origin_safe_headers(req, base_headers, is_same);
        if let Some(rng) = range_header {
            req = req.header(RANGE, rng);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("请求媒体流失败: {e}"))?;

        if matches!(resp.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if let Some(loc) = resp
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                if step >= MAX_STREAM_REDIRECTS {
                    return Err("媒体流重定向次数过多".to_string());
                }
                current_url = current_url
                    .join(loc)
                    .map_err(|e| format!("解析重定向地址失败: {e}"))?;
                continue;
            }
        }

        return Ok((resp, current_url.into()));
    }

    Err("媒体流重定向次数过多".to_string())
}

async fn handle_relay_connection(
    mut stream: TcpStream,
    method: &str,
    token: &str,
    range_header: Option<String>,
) -> Result<(), ()> {
    let Some(session) = find_relay_by_token(token) else {
        let resp = "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(());
    };

    let is_head = method.eq_ignore_ascii_case("HEAD");
    let Ok((mut resp, _final_url)) = send_with_safe_redirects(
        &session.client,
        &session.upstream_url,
        &session.headers,
        range_header.as_deref(),
        is_head,
    )
    .await
    else {
        let err_resp = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(err_resp.as_bytes()).await;
        return Ok(());
    };

    let status = resp.status();
    let reason = status.canonical_reason().unwrap_or("OK");
    let mut header_buf = format!(
        "HTTP/1.1 {} {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n",
        status.as_u16(),
        reason
    );

    if let Some(ct) = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        header_buf.push_str(&format!("Content-Type: {ct}\r\n"));
    }
    if let Some(cl) = resp.headers().get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()) {
        header_buf.push_str(&format!("Content-Length: {cl}\r\n"));
    }
    if let Some(cr) = resp.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
        header_buf.push_str(&format!("Content-Range: {cr}\r\n"));
    }
    let accept_ranges = resp
        .headers()
        .get(ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("bytes");
    header_buf.push_str(&format!("Accept-Ranges: {accept_ranges}\r\n\r\n"));

    if stream.write_all(header_buf.as_bytes()).await.is_err() {
        return Ok(());
    }

    if is_head {
        return Ok(());
    }

    while let Ok(Some(chunk)) = resp.chunk().await {
        if stream.write_all(&chunk).await.is_err() {
            return Ok(());
        }
    }

    let _ = stream.flush().await;
    Ok(())
}

fn build_http_client(proxy_url: Option<&str>, user_agent: &str) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30));

    if let Some(px) = proxy_url.map(str::trim).filter(|s| !s.is_empty()) {
        let proxy = reqwest::Proxy::all(px).map_err(|e| format!("代理地址无效 ({px}): {e}"))?;
        builder = builder.proxy(proxy);
    } else {
        builder = builder.no_proxy();
    }

    builder
        .build()
        .map_err(|e| format!("创建 HTTP 预加载客户端失败: {e}"))
}

fn parse_content_range_total(header_val: Option<&str>) -> Option<u64> {
    let raw = header_val?;
    let (_, total_part) = raw.rsplit_once('/')?;
    total_part.trim().parse::<u64>().ok()
}

async fn run_preload_worker(session: Arc<PreloadSession>) {
    let probe_res = {
        let mut req = session.client.get(&session.upstream_url).header(RANGE, "bytes=0-0");
        for (k, v) in session.headers.iter() {
            req = req.header(k, v);
        }
        req.send().await
    };

    if session.cancelled.load(Ordering::Relaxed) {
        return;
    }

    let mut probe_resp = match probe_res {
        Ok(r) => r,
        Err(e) => {
            if let Ok(mut rt) = session.runtime.write() {
                rt.status = "error".to_string();
                rt.error = Some(format!("探测上游失败: {e}"));
            }
            return;
        }
    };

    let status = probe_resp.status();
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        if let Ok(mut rt) = session.runtime.write() {
            rt.status = "error".to_string();
            rt.error = Some(format!("上游返回异常状态码: {status}"));
        }
        return;
    }

    let content_type = probe_resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .unwrap_or_else(|| "video/x-matroska".to_string());

    if status == reqwest::StatusCode::OK {
        // 上游不支持 Range
        if session.start_seconds > 5.0 {
            if let Ok(mut rt) = session.runtime.write() {
                rt.status = "error".to_string();
                rt.error = Some("媒体源不支持字节范围跳转，已自动保留直连起播".to_string());
            }
            return;
        }
        let total_size = probe_resp.content_length().unwrap_or(0);
        let plan = plan_preload_ranges_by_duration(
            total_size,
            session.duration_seconds,
            0.0,
            session.target_duration_seconds,
            session.max_memory_bytes,
            session.fallback_bitrate_bps,
        );
        let budget = plan
            .target_bytes
            .max(16 * 1024 * 1024)
            .min(session.max_memory_bytes);
        {
            if let Ok(mut rt) = session.runtime.write() {
                rt.total_size = total_size;
                rt.target_bytes = budget;
                rt.target_body_bytes = budget;
                rt.body_range = Some((0, budget));
                rt.bytes_per_sec = plan.bytes_per_sec;
                rt.effective_duration_sec = plan.effective_duration_sec;
                rt.capped_by_memory = plan.capped_by_memory;
                rt.content_type = content_type;
                rt.status = "downloading".to_string();
            }
        }

        let mut written = 0u64;
        while written < budget {
            if session.cancelled.load(Ordering::Relaxed) {
                return;
            }
            match probe_resp.chunk().await {
                Ok(Some(chunk)) => {
                    let take = ((budget - written) as usize).min(chunk.len());
                    if take > 0 {
                        if let Ok(mut rt) = session.runtime.write() {
                            rt.extents.write_at(written, &chunk[..take]);
                        }
                        written += take as u64;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    if let Ok(mut rt) = session.runtime.write() {
                        rt.status = "error".to_string();
                        rt.error = Some(format!("拉取预加载数据中断: {e}"));
                    }
                    return;
                }
            }
        }
        if !session.cancelled.load(Ordering::Relaxed) {
            if let Ok(mut rt) = session.runtime.write() {
                rt.status = "ready".to_string();
            }
        }
        return;
    }

    // 206 Partial Content: 解析总长度与第 1 字节
    let total_size = probe_resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| parse_content_range_total(Some(s)))
        .unwrap_or(0);

    if total_size == 0 {
        if let Ok(mut rt) = session.runtime.write() {
            rt.status = "error".to_string();
            rt.error = Some("无法获取媒体总字节数".to_string());
        }
        return;
    }

    if let Ok(Some(first_bytes)) = probe_resp.chunk().await {
        if !first_bytes.is_empty() {
            if let Ok(mut rt) = session.runtime.write() {
                rt.extents.write_at(0, &first_bytes);
            }
        }
    }
    drop(probe_resp);

    let plan = plan_preload_ranges_by_duration(
        total_size,
        session.duration_seconds,
        session.start_seconds,
        session.target_duration_seconds,
        session.max_memory_bytes,
        session.fallback_bitrate_bps,
    );

    {
        let Ok(mut rt) = session.runtime.write() else {
            return;
        };
        rt.total_size = total_size;
        rt.target_bytes = plan.target_bytes;
        rt.target_body_bytes = plan.target_body_bytes;
        rt.body_range = plan.body_range;
        rt.bytes_per_sec = plan.bytes_per_sec;
        rt.effective_duration_sec = plan.effective_duration_sec;
        rt.capped_by_memory = plan.capped_by_memory;
        rt.skipped_intro = plan.skipped_intro;
        rt.content_type = content_type;
        rt.status = "downloading".to_string();
    }

    for (range_start, range_end_excl) in plan.ranges {
        if session.cancelled.load(Ordering::Relaxed) {
            return;
        }
        if range_end_excl <= range_start {
            continue;
        }

        // 若第 0 字节已被探测写入且当前区间从 0 开始，则从 1 开始拉取避免重复请求
        let already_at_zero = {
            session
                .runtime
                .read()
                .map(|rt| rt.extents.cached_bytes_in_range(range_start, range_start + 1) > 0)
                .unwrap_or(false)
        };
        let fetch_start = if already_at_zero {
            range_start + 1
        } else {
            range_start
        };
        if fetch_start >= range_end_excl {
            continue;
        }

        let range_hdr = format!("bytes={fetch_start}-{}", range_end_excl - 1);
        let mut req = session.client.get(&session.upstream_url).header(RANGE, range_hdr);
        for (k, v) in session.headers.iter() {
            req = req.header(k, v);
        }

        let mut resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                if !session.cancelled.load(Ordering::Relaxed) {
                    if let Ok(mut rt) = session.runtime.write() {
                        rt.status = "error".to_string();
                        rt.error = Some(format!("下载预加载分片失败: {e}"));
                    }
                }
                return;
            }
        };

        if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            if !session.cancelled.load(Ordering::Relaxed) {
                if let Ok(mut rt) = session.runtime.write() {
                    rt.status = "error".to_string();
                    rt.error = Some(format!("分片返回状态码: {}", resp.status()));
                }
            }
            return;
        }

        let mut cursor = fetch_start;
        while cursor < range_end_excl {
            if session.cancelled.load(Ordering::Relaxed) {
                return;
            }
            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    if session.cancelled.load(Ordering::Relaxed) {
                        return;
                    }
                    let max_need = (range_end_excl - cursor) as usize;
                    let slice = if chunk.len() > max_need {
                        &chunk[..max_need]
                    } else {
                        &chunk[..]
                    };
                    if !slice.is_empty() {
                        if let Ok(mut rt) = session.runtime.write() {
                            if rt.extents.total_cached_bytes() + (slice.len() as u64)
                                > session.max_memory_bytes
                            {
                                rt.capped_by_memory = true;
                                break;
                            }
                            rt.extents.write_at(cursor, slice);
                        }
                        cursor += slice.len() as u64;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    if !session.cancelled.load(Ordering::Relaxed) {
                        if let Ok(mut rt) = session.runtime.write() {
                            rt.status = "error".to_string();
                            rt.error = Some(format!("流式写入内存失败: {e}"));
                        }
                    }
                    return;
                }
            }
        }
    }

    if !session.cancelled.load(Ordering::Relaxed) {
        if let Ok(mut rt) = session.runtime.write() {
            if rt.status != "error" && rt.status != "cancelled" && rt.status != "active" {
                rt.status = "ready".to_string();
            }
        }
    }
}

#[tauri::command]
pub async fn start_next_episode_preload(
    request: StartPreloadRequest,
) -> Result<PreloadStatusDto, String> {
    let (user_agent, header_map) = parse_request_headers(request.headers);
    let client = build_http_client(request.proxy_url.as_deref(), &user_agent)?;

    let token = Uuid::new_v4().to_string();
    let max_mem = request.max_memory_bytes.max(64 * 1024 * 1024);
    let skipped_hint = request.start_sec > 5.0 && request.duration_sec > request.start_sec + 1.0;

    let session = Arc::new(PreloadSession {
        token,
        item_id: request.item_id,
        item_name: request.item_name,
        episode_number: request.episode_number,
        upstream_url: request.url,
        client,
        headers: header_map,
        start_seconds: request.start_sec.max(0.0),
        duration_seconds: request.duration_sec.max(0.0),
        target_duration_seconds: request.preload_duration_sec.max(1.0),
        max_memory_bytes: max_mem,
        fallback_bitrate_bps: request.bitrate_bps,
        cancelled: AtomicBool::new(false),
        abort_handle: std::sync::Mutex::new(None),
        runtime: RwLock::new(SessionRuntime::new(
            skipped_hint,
            request.preload_duration_sec.max(1.0),
        )),
    });

    let old_pending = {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        // 开始新剧集预加载前，自动释放旧活跃会话的残余内存块（保留透传代理不中断播放）
        if let Some(ref act) = guard.active {
            act.release_memory();
        }
        let prev = guard.pending.replace(session.clone());
        prev
    };

    if let Some(old) = old_pending {
        old.destroy_all();
    }

    let worker_session = session.clone();
    let join_handle = tokio::spawn(async move {
        run_preload_worker(worker_session).await;
    });
    if let Ok(mut guard) = session.abort_handle.lock() {
        *guard = Some(join_handle.abort_handle());
    }

    Ok(session.to_dto())
}

#[tauri::command]
pub async fn activate_preloaded_episode(
    token: String,
    item_id: String,
) -> Result<Option<ActivatedPreloadDto>, String> {
    let matched_pending = {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        let matches = guard
            .pending
            .as_ref()
            .map(|p| p.token == token && p.item_id == item_id)
            .unwrap_or(false);
        if matches {
            guard.pending.take()
        } else {
            // 若目标并非已预加载剧集，取消任何无效后台预载任务并释放内存
            if let Some(old) = guard.pending.take() {
                old.destroy_all();
            }
            None
        }
    };

    let Some(session) = matched_pending else {
        return Ok(None);
    };

    // 切集瞬间立刻停止后台下载，避免抢占新集网络带宽
    session.cancel_download();

    let (total_size, cached_bytes) = session
        .runtime
        .read()
        .map(|rt| (rt.total_size, rt.extents.total_cached_bytes()))
        .unwrap_or((0, 0));

    if total_size == 0 || cached_bytes == 0 {
        session.destroy_all();
        return Ok(None);
    }

    {
        if let Ok(mut rt) = session.runtime.write() {
            rt.status = "active".to_string();
        }
    }

    let port = ensure_proxy_server_started().await?;

    let old_active = {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        guard.active.replace(session.clone())
    };
    if let Some(old) = old_active {
        old.destroy_all();
    }

    let dto = session.to_dto();
    Ok(Some(ActivatedPreloadDto {
        local_url: format!("http://127.0.0.1:{port}/stream/{}", session.token),
        status: dto,
    }))
}

#[tauri::command]
pub async fn release_active_preload_memory(token: Option<String>) -> Result<(), String> {
    let target = {
        let guard = manager()
            .inner
            .read()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        guard.active.as_ref().and_then(|act| {
            if token.as_ref().map(|t| t == &act.token).unwrap_or(true) {
                Some(act.clone())
            } else {
                None
            }
        })
    };

    if let Some(session) = target {
        session.release_memory();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_preload_status(token: Option<String>) -> Result<Option<PreloadStatusDto>, String> {
    let guard = manager()
        .inner
        .read()
        .map_err(|_| "PreloadManager 锁异常".to_string())?;
    let target = match token {
        Some(ref t) => guard
            .pending
            .as_ref()
            .filter(|p| &p.token == t)
            .or_else(|| guard.active.as_ref().filter(|a| &a.token == t)),
        None => guard.pending.as_ref().or(guard.active.as_ref()),
    };
    Ok(target.map(|s| s.to_dto()))
}

#[tauri::command]
pub async fn cancel_next_episode_preload(token: Option<String>) -> Result<(), String> {
    let removed = {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        let should_remove = guard
            .pending
            .as_ref()
            .map(|p| token.as_ref().map(|t| t == &p.token).unwrap_or(true))
            .unwrap_or(false);
        if should_remove {
            guard.pending.take()
        } else {
            None
        }
    };

    if let Some(session) = removed {
        session.destroy_all();
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_all_preloads() -> Result<(), String> {
    let (pending, active, _relay) = {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        (guard.pending.take(), guard.active.take(), guard.relay.take())
    };
    if let Some(p) = pending {
        p.destroy_all();
    }
    if let Some(a) = active {
        a.destroy_all();
    }
    Ok(())
}

fn read_header_str(headers: &HeaderMap, key: &HeaderName) -> Option<String> {
    headers
        .get(key)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn read_header_name_str(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

async fn read_body_snippet(mut resp: reqwest::Response) -> Option<String> {
    let mut buf: Vec<u8> = Vec::new();
    while buf.len() < 2048 {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                let take = (2048 - buf.len()).min(chunk.len());
                buf.extend_from_slice(&chunk[..take]);
                if take < chunk.len() {
                    break;
                }
            }
            _ => break,
        }
    }
    if buf.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(&buf);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let snippet: String = trimmed.chars().take(300).collect();
    Some(snippet)
}

#[tauri::command]
pub async fn diagnose_stream_url(
    request: DiagnoseStreamRequest,
) -> Result<StreamDiagnosticReport, String> {
    let (user_agent, header_map) = parse_request_headers(request.headers);
    let client = build_no_redirect_http_client(request.proxy_url.as_deref(), &user_agent)?;

    let origin_url = match Url::parse(&request.url) {
        Ok(u) => u,
        Err(e) => {
            return Ok(StreamDiagnosticReport {
                reachable: false,
                final_status: None,
                user_agent,
                summary: format!("流地址格式无效：{e}"),
                hops: vec![DiagnosticHopDto {
                    hop: 1,
                    url: redact_url_secrets(&request.url),
                    status: None,
                    status_text: None,
                    location: None,
                    server: None,
                    content_type: None,
                    content_range: None,
                    accept_ranges: None,
                    cf_ray: None,
                    cf_mitigated: None,
                    body_snippet: None,
                    error: Some(e.to_string()),
                }],
            });
        }
    };

    let mut current_url = origin_url.clone();
    let mut hops: Vec<DiagnosticHopDto> = Vec::new();
    let mut exceeded_redirects = false;

    for hop_idx in 1..=(MAX_STREAM_REDIRECTS + 1) {
        let is_same = same_origin(&origin_url, &current_url);
        let req = apply_origin_safe_headers(
            client.get(current_url.as_str()),
            &header_map,
            is_same,
        )
        .header(RANGE, "bytes=0-0");

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                hops.push(DiagnosticHopDto {
                    hop: hop_idx,
                    url: redact_url_secrets(current_url.as_str()),
                    status: None,
                    status_text: None,
                    location: None,
                    server: None,
                    content_type: None,
                    content_range: None,
                    accept_ranges: None,
                    cf_ray: None,
                    cf_mitigated: None,
                    body_snippet: None,
                    error: Some(e.to_string()),
                });
                break;
            }
        };

        let status = resp.status();
        let status_code = status.as_u16();
        let status_text = status.canonical_reason().map(str::to_string);
        let resp_headers = resp.headers().clone();
        let raw_location = read_header_str(&resp_headers, &LOCATION);
        let server = read_header_str(&resp_headers, &SERVER);
        let content_type = read_header_str(&resp_headers, &CONTENT_TYPE);
        let content_range = read_header_str(&resp_headers, &CONTENT_RANGE);
        let accept_ranges = read_header_str(&resp_headers, &ACCEPT_RANGES);
        let cf_ray = read_header_name_str(&resp_headers, "cf-ray");
        let cf_mitigated = read_header_name_str(&resp_headers, "cf-mitigated");

        if matches!(status_code, 301 | 302 | 303 | 307 | 308) {
            if let Some(ref loc) = raw_location {
                let redacted_loc = match current_url.join(loc) {
                    Ok(joined) => redact_url_secrets(joined.as_str()),
                    Err(_) => redact_url_secrets(loc),
                };
                hops.push(DiagnosticHopDto {
                    hop: hop_idx,
                    url: redact_url_secrets(current_url.as_str()),
                    status: Some(status_code),
                    status_text,
                    location: Some(redacted_loc),
                    server,
                    content_type,
                    content_range,
                    accept_ranges,
                    cf_ray,
                    cf_mitigated,
                    body_snippet: None,
                    error: None,
                });

                if hop_idx > MAX_STREAM_REDIRECTS {
                    exceeded_redirects = true;
                    break;
                }
                match current_url.join(loc) {
                    Ok(next_url) => {
                        current_url = next_url;
                        continue;
                    }
                    Err(e) => {
                        hops.push(DiagnosticHopDto {
                            hop: hop_idx + 1,
                            url: redact_url_secrets(loc),
                            status: None,
                            status_text: None,
                            location: None,
                            server: None,
                            content_type: None,
                            content_range: None,
                            accept_ranges: None,
                            cf_ray: None,
                            cf_mitigated: None,
                            body_snippet: None,
                            error: Some(format!("重定向地址解析失败: {e}")),
                        });
                        break;
                    }
                }
            }
        }

        let is_html = content_type
            .as_deref()
            .map(|ct| ct.to_ascii_lowercase().contains("text/html"))
            .unwrap_or(false);
        let body_snippet = if status_code >= 400 || is_html {
            read_body_snippet(resp).await
        } else {
            None
        };

        hops.push(DiagnosticHopDto {
            hop: hop_idx,
            url: redact_url_secrets(current_url.as_str()),
            status: Some(status_code),
            status_text,
            location: raw_location.map(|l| redact_url_secrets(&l)),
            server,
            content_type,
            content_range,
            accept_ranges,
            cf_ray,
            cf_mitigated,
            body_snippet,
            error: None,
        });
        break;
    }

    let last = hops.last();
    let final_status = last.and_then(|h| h.status);
    let final_is_html = last
        .and_then(|h| h.content_type.as_deref())
        .map(|ct| ct.to_ascii_lowercase().contains("text/html"))
        .unwrap_or(false);
    let reachable = matches!(final_status, Some(200 | 206)) && !final_is_html && !exceeded_redirects;

    let summary = if exceeded_redirects {
        "媒体流重定向次数超过限制，请检查反代或直链配置".to_string()
    } else if reachable {
        "Rust 网络栈探测成功（问题可能位于 libmpv 网络/TLS/302 跳转兼容），可使用内置中转通道播放"
            .to_string()
    } else if let Some(err) = last.and_then(|h| h.error.as_deref()) {
        format!("网络或 TLS 连接失败：{err}")
    } else {
        let cf_challenge = last
            .and_then(|h| h.cf_mitigated.as_deref())
            .map(|v| v.eq_ignore_ascii_case("challenge"))
            .unwrap_or(false)
            || last
                .and_then(|h| h.body_snippet.as_deref())
                .map(|b| {
                    let lb = b.to_ascii_lowercase();
                    lb.contains("cf-challenge")
                        || lb.contains("just a moment")
                        || lb.contains("attention required")
                })
                .unwrap_or(false);

        if cf_challenge {
            "命中 Cloudflare 人机/WAF 质询拦截，请切换代理出口或检查服务端规则".to_string()
        } else if final_is_html {
            "服务器返回了 HTML 页面而非视频流（可能被防盗链、WAF 或登录页拦截）".to_string()
        } else {
            match final_status {
                Some(403) => "服务器返回 HTTP 403 拒绝访问（常见原因：客户端/UA 白名单拦截、Token 失效或 302 网盘风控）".to_string(),
                Some(401) => "服务器返回 HTTP 401 未授权，请重新登录或检查服务器 Token".to_string(),
                Some(404) => "服务器返回 HTTP 404 资源不存在，可尝试改用服务端 DirectStreamUrl 重试".to_string(),
                Some(400) => "服务器返回 HTTP 400 请求参数异常".to_string(),
                Some(code) if code >= 500 => format!("上游服务器或直链返回服务端错误 (HTTP {code})"),
                Some(code) => format!("上游返回非预期 HTTP 状态码 ({code})"),
                None => "未能建立有效的 HTTP 响应，请检查网络连接或代理设置".to_string(),
            }
        }
    };

    Ok(StreamDiagnosticReport {
        reachable,
        final_status,
        user_agent,
        summary,
        hops,
    })
}

#[tauri::command]
pub async fn start_stream_relay(request: StartRelayRequest) -> Result<StartedRelayDto, String> {
    let (user_agent, header_map) = parse_request_headers(request.headers);
    let client = build_no_redirect_http_client(request.proxy_url.as_deref(), &user_agent)?;
    let token = Uuid::new_v4().to_string();

    let session = Arc::new(RelaySession {
        token: token.clone(),
        upstream_url: request.url,
        client,
        headers: header_map,
    });

    {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        guard.relay = Some(session);
    }

    let port = ensure_proxy_server_started().await?;
    Ok(StartedRelayDto {
        token: token.clone(),
        local_url: format!("http://127.0.0.1:{port}/relay/{token}"),
    })
}

#[tauri::command]
pub async fn stop_stream_relay(token: Option<String>) -> Result<(), String> {
    let mut guard = manager()
        .inner
        .write()
        .map_err(|_| "PreloadManager 锁异常".to_string())?;
    let should_clear = match (&guard.relay, &token) {
        (Some(cur), Some(target)) => &cur.token == target,
        (Some(_), None) => true,
        (None, _) => false,
    };
    if should_clear {
        guard.relay = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plan_five_min_normal_1080p_from_start() {
        // 24 分钟剧集，总大小 1.44 GB (~1 MB/s = 8 Mbps)，预加载 5 分钟，内存上限 1024 MB
        let total_size = 1440 * 1024 * 1024u64;
        let plan = plan_preload_ranges_by_duration(
            total_size,
            1440.0,
            0.0,
            300.0,
            1024 * 1024 * 1024,
            None,
        );
        assert!(!plan.skipped_intro);
        assert!(!plan.capped_by_memory);
        assert_eq!(plan.ranges.len(), 3);
        assert_eq!(plan.ranges[0], (0, HEAD_WARMUP_BYTES));
        assert_eq!(plan.ranges[1], (total_size - TAIL_INDEX_BYTES, total_size));
        // 正片从头温暖区之后开始，约 300s * 1.15 * 1MB/s = 345 MB
        assert_eq!(plan.ranges[2].0, HEAD_WARMUP_BYTES);
        assert!(plan.target_bytes < 400 * 1024 * 1024);
    }

    #[test]
    fn test_plan_skip_intro_jumps_past_op_with_vbr_margin() {
        // 24 分钟剧集 (1440s)，总大小 1440 MB (~1 MB/s)，跳过 90s 片头，预加载 5 分钟
        let total_size = 1440 * 1024 * 1024u64;
        let plan = plan_preload_ranges_by_duration(
            total_size,
            1440.0,
            90.0,
            300.0,
            1024 * 1024 * 1024,
            None,
        );
        assert!(plan.skipped_intro);
        assert!(!plan.capped_by_memory);
        assert_eq!(plan.ranges.len(), 3);
        assert_eq!(plan.ranges[0], (0, HEAD_WARMUP_BYTES));
        assert_eq!(plan.ranges[1], (total_size - TAIL_INDEX_BYTES, total_size));
        // 90s -> est_offset = 90 MB，减去约 12s (12 MB) VBR 余量 -> 78 MB
        let expected_start = 90 * 1024 * 1024 - 12 * 1024 * 1024;
        assert_eq!(plan.ranges[2].0, expected_start);
        assert!(plan.ranges[2].1 - plan.ranges[2].0 > 300 * 1024 * 1024);
    }

    #[test]
    fn test_plan_respects_256mb_and_1024mb_memory_cap() {
        // 超高码率 4K Remux：24 分钟，总大小 10 GB (~7.1 MB/s)，5 分钟原始需要 ~2.45 GB
        let total_size = 10u64 * 1024 * 1024 * 1024;
        let plan_256 = plan_preload_ranges_by_duration(
            total_size,
            1440.0,
            120.0,
            300.0,
            256 * 1024 * 1024,
            None,
        );
        assert!(plan_256.capped_by_memory);
        assert!(plan_256.target_bytes <= 256 * 1024 * 1024);

        let plan_1024 = plan_preload_ranges_by_duration(
            total_size,
            1440.0,
            120.0,
            300.0,
            1024 * 1024 * 1024,
            None,
        );
        assert!(plan_1024.capped_by_memory);
        assert!(plan_1024.target_bytes <= 1024 * 1024 * 1024);
    }

    #[test]
    fn test_extent_store_cross_chunk_and_release() {
        let mut store = ExtentStore::default();
        // 跨越 1 MiB Chunk 边界写入 1.5 MiB
        let size = 1536 * 1024usize;
        let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
        store.write_at(100, &data[..CHUNK_SIZE + 12345]);
        store.write_at(100 + (CHUNK_SIZE + 12345) as u64, &data[CHUNK_SIZE + 12345..]);

        assert_eq!(store.total_cached_bytes(), size as u64);
        assert_eq!(store.extents.len(), 1); // 邻接自动合并

        let read_back = store
            .read_cached_prefix(100 + CHUNK_SIZE as u64 - 10, 32)
            .expect("should read across chunk boundary");
        assert_eq!(read_back, data[CHUNK_SIZE - 10..CHUNK_SIZE + 22]);

        store.clear_and_shrink();
        assert_eq!(store.total_cached_bytes(), 0);
        assert!(store.extents.is_empty());
    }

    #[test]
    fn test_parse_http_range_variants() {
        assert_eq!(
            parse_http_range(Some("bytes=0-1023"), 10000),
            RangeParseResult::Satisfiable(0, 1023)
        );
        assert_eq!(
            parse_http_range(Some("bytes=1024-"), 10000),
            RangeParseResult::Satisfiable(1024, 9999)
        );
        assert_eq!(
            parse_http_range(Some("bytes=-500"), 10000),
            RangeParseResult::Satisfiable(9500, 9999)
        );
        assert_eq!(
            parse_http_range(Some("bytes=10000-"), 10000),
            RangeParseResult::Unsatisfiable
        );
        assert_eq!(parse_http_range(None, 10000), RangeParseResult::None);
    }

    #[test]
    fn test_parse_request_headers_extracts_ua_and_auth() {
        let mut raw = HashMap::new();
        raw.insert("uSeR-aGeNt".to_string(), "  Infuse-Direct/7.8.2  ".to_string());
        raw.insert(
            "X-Emby-Authorization".to_string(),
            "Emby Client=\"EmbyTauriPlayer\", Token=\"abc\"".to_string(),
        );
        raw.insert("X-Emby-Token".to_string(), "abc".to_string());

        let (ua, headers) = parse_request_headers(Some(raw));
        assert_eq!(ua, "Infuse-Direct/7.8.2");
        assert!(headers.get("user-agent").is_none());
        assert_eq!(
            headers
                .get("x-emby-authorization")
                .and_then(|v| v.to_str().ok()),
            Some("Emby Client=\"EmbyTauriPlayer\", Token=\"abc\"")
        );
        assert_eq!(
            headers.get("x-emby-token").and_then(|v| v.to_str().ok()),
            Some("abc")
        );

        let (fallback_ua, empty_headers) = parse_request_headers(None);
        assert_eq!(fallback_ua, DEFAULT_USER_AGENT);
        assert!(empty_headers.is_empty());

        let mut blank_ua = HashMap::new();
        blank_ua.insert("User-Agent".to_string(), "   ".to_string());
        let (blank_fallback_ua, blank_headers) = parse_request_headers(Some(blank_ua));
        assert_eq!(blank_fallback_ua, DEFAULT_USER_AGENT);
        assert!(blank_headers.is_empty());
    }

    #[test]
    fn test_redact_url_secrets_masks_tokens() {
        let raw = "https://emby.example.com/emby/Videos/909105/stream.mkv?static=true&MediaSourceId=123&api_key=secretApiKey&X-Emby-Token=secretToken&Signature=sigVal";
        let redacted = redact_url_secrets(raw);
        assert!(redacted.contains("static=true"));
        assert!(redacted.contains("MediaSourceId=123"));
        assert!(redacted.contains("api_key=***"));
        assert!(redacted.contains("X-Emby-Token=***"));
        assert!(redacted.contains("Signature=***"));
        assert!(!redacted.contains("secretApiKey"));
        assert!(!redacted.contains("secretToken"));
        assert!(!redacted.contains("sigVal"));

        assert_eq!(redact_url_secrets("not a valid url"), "not a valid url");
    }

    #[test]
    fn test_same_origin_comparison() {
        let a = Url::parse("https://emby.example.com:443/emby/Videos/1/stream.mkv").unwrap();
        let b = Url::parse("https://EMBY.EXAMPLE.COM/other/path").unwrap();
        let c = Url::parse("https://cdn.example.com/file.mkv").unwrap();
        let d = Url::parse("http://emby.example.com/emby/Videos/1/stream.mkv").unwrap();

        assert!(same_origin(&a, &b));
        assert!(!same_origin(&a, &c));
        assert!(!same_origin(&a, &d));
    }
}
