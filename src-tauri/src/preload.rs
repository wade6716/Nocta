use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

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
const REDIRECT_CACHE_TTL: Duration = Duration::from_secs(90);
const KEEP_ALIVE_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_USER_AGENT: &str = concat!("Nocta/", env!("CARGO_PKG_VERSION"), " (Desktop; EmbyClient)");

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
    pub mid_range_supported: Option<bool>,
    pub total_size: Option<u64>,
    pub is_mkv: bool,
    pub has_mkv_cues: Option<bool>,
    pub mkv_cues_status: Option<String>,
    pub mkv_cues_coverage_sec: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRelayRequest {
    pub url: String,
    pub proxy_url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub slice_target_sec: Option<f64>,
    #[serde(default)]
    pub duration_sec: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedRelayDto {
    pub token: String,
    pub local_url: String,
    pub sliced: bool,
    pub slice_start_sec: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamTransferStatsDto {
    pub token: String,
    pub bytes_sent: u64,
    pub request_count: u64,
    pub recent_requests: Vec<String>,
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

#[derive(Debug, Clone)]
struct ResolvedTargetCache {
    final_url: String,
    expires_at: Instant,
}

const MAX_RECENT_TRANSFER_REQUESTS: usize = 8;

#[derive(Default)]
struct StreamTransferTracker {
    bytes_sent: AtomicU64,
    request_count: AtomicU64,
    recent_requests: RwLock<VecDeque<String>>,
}

impl StreamTransferTracker {
    fn add_bytes(&self, bytes: u64) {
        if bytes > 0 {
            self.bytes_sent.fetch_add(bytes, Ordering::Relaxed);
        }
    }

    fn record_request(
        &self,
        method: &str,
        status: u16,
        range_hdr: Option<&str>,
        content_range: Option<&str>,
    ) {
        self.request_count.fetch_add(1, Ordering::Relaxed);
        let entry = format!(
            "{} {} -> HTTP {}{}",
            method,
            range_hdr.unwrap_or("(no Range)"),
            status,
            content_range
                .map(|cr| format!(" [{cr}]"))
                .unwrap_or_default()
        );
        if let Ok(mut guard) = self.recent_requests.write() {
            if guard.len() >= MAX_RECENT_TRANSFER_REQUESTS {
                guard.pop_front();
            }
            guard.push_back(entry);
        }
    }

    fn to_dto(&self, token: &str) -> StreamTransferStatsDto {
        let recent_requests = self
            .recent_requests
            .read()
            .map(|g| g.iter().cloned().collect())
            .unwrap_or_default();
        StreamTransferStatsDto {
            token: token.to_string(),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            request_count: self.request_count.load(Ordering::Relaxed),
            recent_requests,
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
    resolved_target: RwLock<Option<ResolvedTargetCache>>,
    start_seconds: f64,
    duration_seconds: f64,
    target_duration_seconds: f64,
    max_memory_bytes: u64,
    fallback_bitrate_bps: Option<u64>,
    cancelled: AtomicBool,
    abort_handle: std::sync::Mutex<Option<tokio::task::AbortHandle>>,
    runtime: RwLock<SessionRuntime>,
    transfer: StreamTransferTracker,
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

struct MkvSliceOverlay {
    head_prefix: Vec<u8>,
    upstream_cut_offset: u64,
    virtual_total_size: u64,
    slice_start_sec: f64,
}

struct RelaySession {
    token: String,
    upstream_url: String,
    client: reqwest::Client,
    headers: HeaderMap,
    resolved_target: RwLock<Option<ResolvedTargetCache>>,
    slice: Option<MkvSliceOverlay>,
    transfer: StreamTransferTracker,
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

fn should_keep_alive(http_version: &str, connection_hdr: Option<&str>) -> bool {
    let conn = connection_hdr
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if conn.split(',').any(|t| t.trim() == "close") {
        return false;
    }
    if http_version.eq_ignore_ascii_case("HTTP/1.0") {
        return conn.split(',').any(|t| t.trim() == "keep-alive");
    }
    true
}

async fn handle_proxy_connection(stream: TcpStream) -> Result<(), ()> {
    let _ = stream.set_nodelay(true);
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    let mut line = String::new();

    for _req_idx in 0..100 {
        request_line.clear();
        let Ok(Ok(n)) =
            tokio::time::timeout(KEEP_ALIVE_IDLE_TIMEOUT, reader.read_line(&mut request_line))
                .await
        else {
            break;
        };
        if n == 0 {
            break;
        }
        if request_line == "\r\n" || request_line == "\n" {
            continue;
        }

        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let raw_path = parts.next().unwrap_or("").to_string();
        let http_version = parts.next().unwrap_or("HTTP/1.1").to_string();

        let mut range_header: Option<String> = None;
        let mut connection_header: Option<String> = None;
        loop {
            line.clear();
            let Ok(Ok(hdr_n)) =
                tokio::time::timeout(KEEP_ALIVE_IDLE_TIMEOUT, reader.read_line(&mut line)).await
            else {
                return Ok(());
            };
            if hdr_n == 0 || line == "\r\n" || line == "\n" {
                break;
            }
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim();
                if key.eq_ignore_ascii_case("range") {
                    range_header = Some(v.trim().to_string());
                } else if key.eq_ignore_ascii_case("connection") {
                    connection_header = Some(v.trim().to_string());
                }
            }
        }

        let keep_alive = should_keep_alive(&http_version, connection_header.as_deref());

        if !method.eq_ignore_ascii_case("GET") && !method.eq_ignore_ascii_case("HEAD") {
            let resp =
                "HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
            let _ = reader.get_mut().write_all(resp.as_bytes()).await;
            break;
        }

        let path = raw_path.split('?').next().unwrap_or(&raw_path);
        let continue_loop = if let Some(relay_token) = path.strip_prefix("/relay/") {
            handle_relay_request(
                reader.get_mut(),
                &method,
                relay_token,
                range_header,
                keep_alive,
            )
            .await
            .unwrap_or(false)
        } else {
            let token = path.strip_prefix("/stream/").unwrap_or("");
            handle_stream_request(reader.get_mut(), &method, token, range_header, keep_alive)
                .await
                .unwrap_or(false)
        };

        if !continue_loop {
            break;
        }
    }

    Ok(())
}

async fn handle_stream_request(
    stream: &mut TcpStream,
    method: &str,
    token: &str,
    range_header: Option<String>,
    keep_alive: bool,
) -> Result<bool, ()> {
    let Some(session) = find_session_by_token(token) else {
        let resp = "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(false);
    };

    let (total_size, content_type) = {
        let rt = session.runtime.read().map_err(|_| ())?;
        (rt.total_size, rt.content_type.clone())
    };

    if total_size == 0 {
        let resp = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(false);
    }

    let is_head = method.eq_ignore_ascii_case("HEAD");
    let (status_code, status_line, req_start, req_end, content_range_hdr) =
        match parse_http_range(range_header.as_deref(), total_size) {
            RangeParseResult::None => (200u16, "HTTP/1.1 200 OK", 0, total_size - 1, None),
            RangeParseResult::Satisfiable(s, e) => (
                206u16,
                "HTTP/1.1 206 Partial Content",
                s,
                e,
                Some(format!("Content-Range: bytes {s}-{e}/{total_size}\r\n")),
            ),
            RangeParseResult::Unsatisfiable => {
                session
                    .transfer
                    .record_request(method, 416, range_header.as_deref(), None);
                let resp = format!(
                    "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total_size}\r\nAccept-Ranges: bytes\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                return Ok(false);
            }
        };

    let cr_clean = content_range_hdr
        .as_deref()
        .map(|s| s.trim_start_matches("Content-Range: ").trim());
    session
        .transfer
        .record_request(method, status_code, range_header.as_deref(), cr_clean);

    let content_len = req_end - req_start + 1;
    let conn_hdr = if keep_alive {
        "Connection: keep-alive\r\nKeep-Alive: timeout=30, max=100\r\n"
    } else {
        "Connection: close\r\n"
    };
    let mut header_buf = format!(
        "{status_line}\r\nContent-Type: {content_type}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {content_len}\r\n{conn_hdr}"
    );
    if let Some(cr) = content_range_hdr {
        header_buf.push_str(&cr);
    }
    header_buf.push_str("\r\n");

    if stream.write_all(header_buf.as_bytes()).await.is_err() {
        return Ok(false);
    }

    if is_head {
        let _ = stream.flush().await;
        return Ok(keep_alive);
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
                    return Ok(false);
                }
                session.transfer.add_bytes(len);
                cursor += len;
            }
            SliceAction::GapTo(gap_end) => {
                let range_val = format!("bytes={cursor}-{gap_end}");
                let Ok((mut resp, _)) = send_with_cached_redirects(
                    &session.client,
                    &session.upstream_url,
                    &session.headers,
                    Some(&range_val),
                    false,
                    &session.resolved_target,
                )
                .await
                else {
                    return Ok(false);
                };
                if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT
                {
                    return Ok(false);
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
                                return Ok(false);
                            }
                            let written = slice.len() as u64;
                            session.transfer.add_bytes(written);
                            sent_gap += written;
                            cursor += written;
                        }
                        Ok(None) => break,
                        Err(_) => return Ok(false),
                    }
                }

                if sent_gap == 0 {
                    return Ok(false);
                }
            }
        }
    }

    if stream.flush().await.is_err() {
        return Ok(false);
    }
    Ok(keep_alive)
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

    if let Some(px) = proxy_url.and_then(crate::proxy::normalize_proxy_url) {
        let proxy = reqwest::Proxy::all(&px).map_err(|e| format!("代理地址无效 ({px}): {e}"))?;
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
    crate::proxy::emit_observed_emby_host(start_url, start_url, "stream");

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
                crate::proxy::emit_observed_emby_host(start_url, current_url.as_str(), "redirect");
                continue;
            }
        }

        return Ok((resp, current_url.into()));
    }

    Err("媒体流重定向次数过多".to_string())
}

async fn send_with_cached_redirects(
    client: &reqwest::Client,
    origin_url_str: &str,
    base_headers: &HeaderMap,
    range_header: Option<&str>,
    is_head: bool,
    cache: &RwLock<Option<ResolvedTargetCache>>,
) -> Result<(reqwest::Response, String), String> {
    let cached_url = cache
        .read()
        .ok()
        .and_then(|g| g.clone())
        .filter(|entry| Instant::now() < entry.expires_at)
        .map(|entry| entry.final_url);

    if let Some(ref target) = cached_url {
        if let (Ok(origin_parsed), Ok(target_parsed)) =
            (Url::parse(origin_url_str), Url::parse(target))
        {
            let mut req = if is_head {
                client.head(target.as_str())
            } else {
                client.get(target.as_str())
            };
            let is_same = same_origin(&origin_parsed, &target_parsed);
            req = apply_origin_safe_headers(req, base_headers, is_same);
            if let Some(rng) = range_header {
                req = req.header(RANGE, rng);
            }

            if let Ok(resp) = req.send().await {
                if matches!(resp.status().as_u16(), 200 | 206) {
                    return Ok((resp, target.clone()));
                }
            }
        }
        if let Ok(mut guard) = cache.write() {
            *guard = None;
        }
    }

    let (resp, final_url) =
        send_with_safe_redirects(client, origin_url_str, base_headers, range_header, is_head)
            .await?;

    if matches!(resp.status().as_u16(), 200 | 206) && final_url != origin_url_str {
        if let Ok(mut guard) = cache.write() {
            *guard = Some(ResolvedTargetCache {
                final_url: final_url.clone(),
                expires_at: Instant::now() + REDIRECT_CACHE_TTL,
            });
        }
    }

    Ok((resp, final_url))
}

async fn handle_sliced_relay_request(
    stream: &mut TcpStream,
    session: &RelaySession,
    slice: &MkvSliceOverlay,
    method: &str,
    range_header: Option<&str>,
    keep_alive: bool,
) -> Result<bool, ()> {
    let is_head = method.eq_ignore_ascii_case("HEAD");
    let total_size = slice.virtual_total_size;
    let (status_code, status_line, req_start, req_end, content_range_hdr) =
        match parse_http_range(range_header, total_size) {
            RangeParseResult::None => (200u16, "HTTP/1.1 200 OK", 0, total_size - 1, None),
            RangeParseResult::Satisfiable(s, e) => (
                206u16,
                "HTTP/1.1 206 Partial Content",
                s,
                e,
                Some(format!("Content-Range: bytes {s}-{e}/{total_size}\r\n")),
            ),
            RangeParseResult::Unsatisfiable => {
                session
                    .transfer
                    .record_request(method, 416, range_header, None);
                let resp = format!(
                    "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total_size}\r\nAccept-Ranges: bytes\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                return Ok(false);
            }
        };

    let cr_clean = content_range_hdr
        .as_deref()
        .map(|s| s.trim_start_matches("Content-Range: ").trim());
    session
        .transfer
        .record_request(method, status_code, range_header, cr_clean);

    let content_len = req_end - req_start + 1;
    let conn_hdr = if keep_alive {
        "Connection: keep-alive\r\nKeep-Alive: timeout=30, max=100\r\n"
    } else {
        "Connection: close\r\n"
    };
    let mut header_buf = format!(
        "{status_line}\r\nContent-Type: video/x-matroska\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {content_len}\r\n{conn_hdr}"
    );
    if let Some(ref cr) = content_range_hdr {
        header_buf.push_str(cr);
    }
    header_buf.push_str("\r\n");

    if stream.write_all(header_buf.as_bytes()).await.is_err() {
        return Ok(false);
    }
    if is_head {
        let _ = stream.flush().await;
        return Ok(keep_alive);
    }

    let prefix_len = slice.head_prefix.len() as u64;
    if req_start < prefix_len {
        let p_start = req_start as usize;
        let p_end = (req_end + 1).min(prefix_len) as usize;
        let part = &slice.head_prefix[p_start..p_end];
        if stream.write_all(part).await.is_err() {
            return Ok(false);
        }
        session.transfer.add_bytes(part.len() as u64);
    }

    if req_end >= prefix_len {
        let body_rel_start = req_start.saturating_sub(prefix_len);
        let body_rel_end = req_end - prefix_len;
        let up_start = slice.upstream_cut_offset.saturating_add(body_rel_start);
        let up_end = slice.upstream_cut_offset.saturating_add(body_rel_end);
        let range_val = format!("bytes={up_start}-{up_end}");
        let Ok((mut resp, _)) = send_with_cached_redirects(
            &session.client,
            &session.upstream_url,
            &session.headers,
            Some(&range_val),
            false,
            &session.resolved_target,
        )
        .await
        else {
            return Ok(false);
        };
        let up_status = resp.status();
        if up_status != reqwest::StatusCode::PARTIAL_CONTENT
            && !(up_start == 0 && up_status.is_success())
        {
            return Ok(false);
        }

        let need_total = up_end - up_start + 1;
        let mut sent = 0u64;
        while sent < need_total {
            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    let take = ((need_total - sent) as usize).min(chunk.len());
                    if take == 0 {
                        break;
                    }
                    if stream.write_all(&chunk[..take]).await.is_err() {
                        return Ok(false);
                    }
                    session.transfer.add_bytes(take as u64);
                    sent += take as u64;
                }
                Ok(None) => break,
                Err(_) => return Ok(false),
            }
        }
        if sent < need_total {
            return Ok(false);
        }
    }

    if stream.flush().await.is_err() {
        return Ok(false);
    }
    Ok(keep_alive)
}

async fn handle_relay_request(
    stream: &mut TcpStream,
    method: &str,
    token: &str,
    range_header: Option<String>,
    keep_alive: bool,
) -> Result<bool, ()> {
    let Some(session) = find_relay_by_token(token) else {
        let resp = "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return Ok(false);
    };

    if let Some(ref slice) = session.slice {
        return handle_sliced_relay_request(
            stream,
            &session,
            slice,
            method,
            range_header.as_deref(),
            keep_alive,
        )
        .await;
    }

    let is_head = method.eq_ignore_ascii_case("HEAD");
    let Ok((mut resp, _final_url)) = send_with_cached_redirects(
        &session.client,
        &session.upstream_url,
        &session.headers,
        range_header.as_deref(),
        is_head,
        &session.resolved_target,
    )
    .await
    else {
        session
            .transfer
            .record_request(method, 502, range_header.as_deref(), None);
        let err_resp = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        let _ = stream.write_all(err_resp.as_bytes()).await;
        return Ok(false);
    };

    let status = resp.status();
    let reason = status.canonical_reason().unwrap_or("OK");
    let cl_opt = resp
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let cr_opt = resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    session.transfer.record_request(
        method,
        status.as_u16(),
        range_header.as_deref(),
        cr_opt.as_deref(),
    );

    let can_keep_alive = keep_alive && (is_head || cl_opt.is_some());
    let conn_val = if can_keep_alive {
        "keep-alive\r\nKeep-Alive: timeout=30, max=100"
    } else {
        "close"
    };

    let mut header_buf = format!(
        "HTTP/1.1 {} {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: {}\r\n",
        status.as_u16(),
        reason,
        conn_val
    );

    if let Some(ct) = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        header_buf.push_str(&format!("Content-Type: {ct}\r\n"));
    }
    if let Some(ref cl) = cl_opt {
        header_buf.push_str(&format!("Content-Length: {cl}\r\n"));
    }
    if let Some(ref cr) = cr_opt {
        header_buf.push_str(&format!("Content-Range: {cr}\r\n"));
    }
    let accept_ranges = resp
        .headers()
        .get(ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("bytes");
    header_buf.push_str(&format!("Accept-Ranges: {accept_ranges}\r\n\r\n"));

    if stream.write_all(header_buf.as_bytes()).await.is_err() {
        return Ok(false);
    }

    if is_head {
        let _ = stream.flush().await;
        return Ok(can_keep_alive);
    }

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if stream.write_all(&chunk).await.is_err() {
                    return Ok(false);
                }
                session.transfer.add_bytes(chunk.len() as u64);
            }
            Ok(None) => break,
            Err(_) => return Ok(false),
        }
    }

    if stream.flush().await.is_err() {
        return Ok(false);
    }
    Ok(can_keep_alive)
}

fn parse_content_range_total(header_val: Option<&str>) -> Option<u64> {
    let raw = header_val?;
    let (_, total_part) = raw.rsplit_once('/')?;
    total_part.trim().parse::<u64>().ok()
}

async fn run_preload_worker(session: Arc<PreloadSession>) {
    let probe_res = send_with_cached_redirects(
        &session.client,
        &session.upstream_url,
        &session.headers,
        Some("bytes=0-0"),
        false,
        &session.resolved_target,
    )
    .await;

    if session.cancelled.load(Ordering::Relaxed) {
        return;
    }

    let mut probe_resp = match probe_res {
        Ok((r, _)) => r,
        Err(e) => {
            if let Ok(mut rt) = session.runtime.write() {
                rt.status = "error".to_string();
                rt.error = Some(e);
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
        let mut resp = match send_with_cached_redirects(
            &session.client,
            &session.upstream_url,
            &session.headers,
            Some(&range_hdr),
            false,
            &session.resolved_target,
        )
        .await
        {
            Ok((r, _)) => r,
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
    let client = build_no_redirect_http_client(request.proxy_url.as_deref(), &user_agent)?;

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
        resolved_target: RwLock::new(None),
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
        transfer: StreamTransferTracker::default(),
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

async fn read_limited_bytes(mut resp: reqwest::Response, max_bytes: usize) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::with_capacity(max_bytes.min(131072));
    while buf.len() < max_bytes {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                let take = (max_bytes - buf.len()).min(chunk.len());
                buf.extend_from_slice(&chunk[..take]);
                if take < chunk.len() {
                    break;
                }
            }
            _ => break,
        }
    }
    buf
}

async fn read_body_snippet(resp: reqwest::Response) -> Option<String> {
    let buf = read_limited_bytes(resp, 2048).await;
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

fn summarize_diagnostic_outcome(
    exceeded_redirects: bool,
    reachable: bool,
    last: Option<&DiagnosticHopDto>,
    final_status: Option<u16>,
    final_is_html: bool,
) -> String {
    if exceeded_redirects {
        return "媒体流重定向次数超过限制，请检查反代或直链配置".to_string();
    }
    if reachable {
        return "Rust 网络栈探测成功（问题可能位于 libmpv 网络/TLS/302 跳转兼容），可使用内置中转通道播放"
            .to_string();
    }
    if let Some(err) = last.and_then(|h| h.error.as_deref()) {
        return format!("网络或 TLS 连接失败：{err}");
    }

    let body_lower = last
        .and_then(|h| h.body_snippet.as_deref())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    let cf_challenge = last
        .and_then(|h| h.cf_mitigated.as_deref())
        .map(|v| v.eq_ignore_ascii_case("challenge"))
        .unwrap_or(false)
        || body_lower.contains("cf-challenge")
        || body_lower.contains("just a moment")
        || body_lower.contains("attention required");

    if cf_challenge {
        return "命中 Cloudflare 人机/WAF 质询拦截，请切换代理出口或检查服务端规则".to_string();
    }
    if final_is_html {
        return "服务器返回了 HTML 页面而非视频流（可能被防盗链、WAF 或登录页拦截）".to_string();
    }
    if final_status == Some(530) || body_lower.contains("error code: 1033") {
        return "上游存储节点返回 HTTP 530 (Cloudflare error 1033)：直链指向的 Cloudflare Tunnel 穿透节点已离线或迁移（若为 .strm 媒体，需经 Emby 服务端 /videos/{id}/stream 302 动态重写节点）".to_string();
    }

    match final_status {
        Some(403) => "服务器返回 HTTP 403 拒绝访问（常见原因：客户端/UA 白名单拦截、Token 失效或 302 网盘风控）".to_string(),
        Some(401) => "服务器返回 HTTP 401 未授权，请重新登录或检查服务器 Token".to_string(),
        Some(404) => "服务器返回 HTTP 404 资源不存在，可尝试改用服务端 DirectStreamUrl 重试".to_string(),
        Some(400) => "服务器返回 HTTP 400 请求参数异常".to_string(),
        Some(code @ (521..=526)) => {
            format!("上游源站连接异常 (Cloudflare HTTP {code})：直链源站宕机、超时或 SSL 握手失败")
        }
        Some(code) if code >= 500 => format!("上游服务器或直链返回服务端错误 (HTTP {code})"),
        Some(code) => format!("上游返回非预期 HTTP 状态码 ({code})"),
        None => "未能建立有效的 HTTP 响应，请检查网络连接或代理设置".to_string(),
    }
}

fn read_ebml_id(bytes: &[u8], pos: usize) -> Option<(u32, usize)> {
    let first = *bytes.get(pos)?;
    if first == 0 {
        return None;
    }
    let len = first.leading_zeros() as usize + 1;
    if len > 4 || pos + len > bytes.len() {
        return None;
    }
    let mut id = 0u32;
    for &b in &bytes[pos..pos + len] {
        id = (id << 8) | (b as u32);
    }
    Some((id, len))
}

fn read_ebml_size(bytes: &[u8], pos: usize) -> Option<(Option<u64>, usize)> {
    let first = *bytes.get(pos)?;
    if first == 0 {
        return None;
    }
    let len = first.leading_zeros() as usize + 1;
    if len > 8 || pos + len > bytes.len() {
        return None;
    }
    let mask = if len == 8 { 0 } else { 0xFFu8 >> len };
    let mut val = (first & mask) as u64;
    for &b in &bytes[pos + 1..pos + len] {
        val = (val << 8) | (b as u64);
    }
    let unknown_marker = (1u64 << (7 * len)) - 1;
    let size = if val == unknown_marker { None } else { Some(val) };
    Some((size, len))
}

fn read_ebml_uint_be(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() || bytes.len() > 8 {
        return None;
    }
    let mut val = 0u64;
    for &b in bytes {
        val = (val << 8) | (b as u64);
    }
    Some(val)
}

fn read_ebml_float_be(bytes: &[u8]) -> Option<f64> {
    match bytes.len() {
        4 => Some(f32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64),
        8 => Some(f64::from_be_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ])),
        _ => None,
    }
}

/// 原地将任意长度 >= 2 的 EBML 元素覆写为等长 Void (0xEC)，保持后续元素偏移完全不变。
fn write_ebml_void_in_place(buf: &mut [u8]) -> bool {
    if buf.len() < 2 {
        return false;
    }
    for w in 1..=8usize {
        if 1 + w > buf.len() {
            break;
        }
        let payload_len = (buf.len() - 1 - w) as u64;
        let unknown_marker = if w == 8 {
            (1u64 << 56) - 1
        } else {
            (1u64 << (7 * w)) - 1
        };
        if payload_len < unknown_marker {
            buf[0] = 0xEC;
            let mut rem = payload_len;
            for idx in (0..w).rev() {
                buf[1 + idx] = (rem & 0xFF) as u8;
                rem >>= 8;
            }
            if w == 8 {
                buf[1] |= 0x01;
            } else {
                buf[1] |= 1u8 << (8 - w);
            }
            buf[1 + w..].fill(0);
            return true;
        }
    }
    false
}

struct MkvHeadCueInspection {
    segment_data_start: u64,
    timestamp_scale_ns: u64,
    duration_sec: Option<f64>,
    inline_cues_range: Option<(usize, usize)>,
    inline_cues_complete: bool,
    cues_abs_offset: Option<u64>,
    cues_seek_without_pos: bool,
    secondary_seekhead_offset: Option<u64>,
    reached_first_cluster: bool,
}

fn parse_seekhead_entries(
    bytes: &[u8],
    sh_data: usize,
    sh_end: usize,
    segment_data_start: u64,
) -> (Option<u64>, bool, Option<u64>) {
    let mut cues_abs_offset: Option<u64> = None;
    let mut cues_seek_without_pos = false;
    let mut secondary_seekhead_offset: Option<u64> = None;

    let mut sp = sh_data;
    while sp < sh_end {
        let Some((sid, sil)) = read_ebml_id(bytes, sp) else {
            break;
        };
        let Some((ssz_opt, ssl)) = read_ebml_size(bytes, sp + sil) else {
            break;
        };
        let sdata = sp + sil + ssl;
        let Some(ssz) = ssz_opt.and_then(|s| usize::try_from(s).ok()) else {
            break;
        };
        let send = sdata.saturating_add(ssz).min(sh_end);
        if sid == 0x4DBB {
            let mut kp = sdata;
            let mut seek_id_bytes: Option<&[u8]> = None;
            let mut seek_pos: Option<u64> = None;
            while kp < send {
                let Some((kid, kil)) = read_ebml_id(bytes, kp) else {
                    break;
                };
                let Some((ksz_opt, ksl)) = read_ebml_size(bytes, kp + kil) else {
                    break;
                };
                let kdata = kp + kil + ksl;
                let Some(ksz) = ksz_opt.and_then(|s| usize::try_from(s).ok()) else {
                    break;
                };
                let kend = kdata.saturating_add(ksz).min(send);
                if kid == 0x53AB && kdata + ksz <= send {
                    seek_id_bytes = Some(&bytes[kdata..kend]);
                } else if kid == 0x53AC && kdata + ksz <= send {
                    seek_pos = read_ebml_uint_be(&bytes[kdata..kend]);
                }
                kp = kend;
            }
            if seek_id_bytes == Some(&[0x1C, 0x53, 0xBB, 0x6B]) {
                if let Some(pos_rel) = seek_pos {
                    cues_abs_offset = Some(segment_data_start.saturating_add(pos_rel));
                } else {
                    cues_seek_without_pos = true;
                }
            } else if seek_id_bytes == Some(&[0x11, 0x4D, 0x9B, 0x74]) && secondary_seekhead_offset.is_none() {
                if let Some(pos_rel) = seek_pos {
                    secondary_seekhead_offset = Some(segment_data_start.saturating_add(pos_rel));
                }
            }
        }
        sp = send;
    }

    (cues_abs_offset, cues_seek_without_pos, secondary_seekhead_offset)
}

/// 解析 MKV 头部，提取 Segment 偏移、时长、头部内联 Cues 以及 SeekHead 中的 Cues 绝对偏移。
fn inspect_mkv_head_cues(bytes: &[u8]) -> Option<MkvHeadCueInspection> {
    if bytes.len() < 12 || bytes[0..4] != [0x1A, 0x45, 0xDF, 0xA3] {
        return None;
    }
    let (ebml_id, id_len) = read_ebml_id(bytes, 0)?;
    if ebml_id != 0x1A45_DFA3 {
        return None;
    }
    let (ebml_sz, sz_len) = read_ebml_size(bytes, id_len)?;
    let mut pos = id_len + sz_len + usize::try_from(ebml_sz?).ok()?;

    let (segment_data_start, seg_end) = loop {
        if pos >= bytes.len() {
            return None;
        }
        let (id, il) = read_ebml_id(bytes, pos)?;
        let (sz_opt, sl) = read_ebml_size(bytes, pos + il)?;
        let data_start = pos + il + sl;
        if id == 0x1853_8067 {
            pos = data_start;
            let end = match sz_opt.and_then(|s| usize::try_from(s).ok()) {
                Some(s) => data_start.saturating_add(s).min(bytes.len()),
                None => bytes.len(),
            };
            break (data_start as u64, end);
        }
        let skip = usize::try_from(sz_opt?).ok()?;
        pos = data_start.checked_add(skip)?;
    };

    let mut ts_scale_ns: u64 = 1_000_000;
    let mut duration_ticks: Option<f64> = None;
    let mut inline_cues_range: Option<(usize, usize)> = None;
    let mut inline_cues_complete = false;
    let mut cues_abs_offset: Option<u64> = None;
    let mut cues_seek_without_pos = false;
    let mut secondary_seekhead_offset: Option<u64> = None;
    let mut reached_first_cluster = false;

    while pos < seg_end {
        let Some((id, il)) = read_ebml_id(bytes, pos) else {
            break;
        };
        let Some((sz_opt, sl)) = read_ebml_size(bytes, pos + il) else {
            break;
        };
        let data_start = pos + il + sl;
        if id == 0x1F43_B675 {
            reached_first_cluster = true;
            break;
        }
        let Some(sz) = sz_opt.and_then(|s| usize::try_from(s).ok()) else {
            break;
        };
        let raw_end = data_start.saturating_add(sz);
        let elem_end = raw_end.min(seg_end);

        if id == 0x1549_A966 {
            let mut ip = data_start;
            while ip < elem_end {
                let Some((iid, iil)) = read_ebml_id(bytes, ip) else {
                    break;
                };
                let Some((isz_opt, isl)) = read_ebml_size(bytes, ip + iil) else {
                    break;
                };
                let idata = ip + iil + isl;
                let Some(isz) = isz_opt.and_then(|s| usize::try_from(s).ok()) else {
                    break;
                };
                let iend = idata.saturating_add(isz).min(elem_end);
                if iid == 0x2AD7_B1 {
                    if let Some(v) = read_ebml_uint_be(&bytes[idata..iend]).filter(|&v| v > 0) {
                        ts_scale_ns = v;
                    }
                } else if iid == 0x4489 {
                    if let Some(d) = read_ebml_float_be(&bytes[idata..iend]).filter(|d| d.is_finite() && *d > 0.0) {
                        duration_ticks = Some(d);
                    }
                }
                ip = iend;
            }
        } else if id == 0x1C53_BB6B {
            if inline_cues_range.is_none() {
                inline_cues_range = Some((pos, elem_end));
                inline_cues_complete = raw_end <= bytes.len();
            }
            if raw_end > bytes.len() && cues_abs_offset.is_none() {
                cues_abs_offset = Some(pos as u64);
            }
        } else if id == 0x114D_9B74 {
            let (found_cues, no_pos, sec_sh) =
                parse_seekhead_entries(bytes, data_start, elem_end, segment_data_start);
            if cues_abs_offset.is_none() {
                cues_abs_offset = found_cues;
            }
            cues_seek_without_pos |= no_pos;
            if secondary_seekhead_offset.is_none() {
                secondary_seekhead_offset = sec_sh;
            }
        }

        if sz == 0 && data_start == pos {
            break;
        }
        if raw_end > seg_end {
            break;
        }
        pos = elem_end;
    }

    let duration_sec = duration_ticks.map(|t| (t * ts_scale_ns as f64) / 1_000_000_000.0);
    Some(MkvHeadCueInspection {
        segment_data_start,
        timestamp_scale_ns: ts_scale_ns,
        duration_sec,
        inline_cues_range,
        inline_cues_complete,
        cues_abs_offset,
        cues_seek_without_pos,
        secondary_seekhead_offset,
        reached_first_cluster,
    })
}

/// 从 Cues 起始切片或 Cues 尾部切片提取有效 CuePoint 数量与最大 CueTime（秒）。
fn extract_cue_points_max_time_sec(
    bytes: &[u8],
    ts_scale_ns: u64,
    is_cues_start: bool,
    max_valid_sec: Option<f64>,
) -> (usize, Option<f64>) {
    let mut count = 0usize;
    let mut max_sec: Option<f64> = None;

    if is_cues_start {
        let Some((id, il)) = read_ebml_id(bytes, 0) else {
            return (0, None);
        };
        if id != 0x1C53_BB6B {
            return (0, None);
        }
        let Some((sz_opt, sl)) = read_ebml_size(bytes, il) else {
            return (0, None);
        };
        let start = il + sl;
        let end = match sz_opt.and_then(|s| usize::try_from(s).ok()) {
            Some(sz) => start.saturating_add(sz).min(bytes.len()),
            None => bytes.len(),
        };
        let mut pos = start;
        while pos < end {
            let Some((cid, cil)) = read_ebml_id(bytes, pos) else {
                break;
            };
            let Some((csz_opt, csl)) = read_ebml_size(bytes, pos + cil) else {
                break;
            };
            let cdata = pos + cil + csl;
            let Some(csz) = csz_opt.and_then(|s| usize::try_from(s).ok()) else {
                break;
            };
            let cend = cdata.saturating_add(csz);
            if cend > end {
                break;
            }
            if cid == 0xBB {
                let mut kp = cdata;
                while kp < cend {
                    let Some((kid, kil)) = read_ebml_id(bytes, kp) else {
                        break;
                    };
                    let Some((ksz_opt, ksl)) = read_ebml_size(bytes, kp + kil) else {
                        break;
                    };
                    let kdata = kp + kil + ksl;
                    let Some(ksz) = ksz_opt.and_then(|s| usize::try_from(s).ok()) else {
                        break;
                    };
                    let kend = kdata.saturating_add(ksz);
                    if kend > cend {
                        break;
                    }
                    if kid == 0xB3 {
                        if let Some(ticks) = read_ebml_uint_be(&bytes[kdata..kend]) {
                            let ts = (ticks as f64) * (ts_scale_ns as f64) / 1_000_000_000.0;
                            if ts.is_finite()
                                && ts >= 0.0
                                && max_valid_sec.map(|m| ts <= m).unwrap_or(true)
                            {
                                count += 1;
                                max_sec = Some(max_sec.map(|m| m.max(ts)).unwrap_or(ts));
                            }
                        }
                        break;
                    }
                    kp = kend;
                }
            } else if cid != 0xEC {
                break;
            }
            pos = cend;
        }
        return (count, max_sec);
    }

    // 尾部切片扫描：查找 CuePoint (0xBB) -> CueTime (0xB3) -> CueTrackPositions (0xB7)
    let mut i = 0usize;
    while i + 6 <= bytes.len() {
        if bytes[i] != 0xBB {
            i += 1;
            continue;
        }
        let Some((Some(sz), sl)) = read_ebml_size(bytes, i + 1) else {
            i += 1;
            continue;
        };
        if !(4..=256).contains(&sz) {
            i += 1;
            continue;
        }
        let cdata = i + 1 + sl;
        let cend = cdata.saturating_add(sz as usize);
        if cend > bytes.len() {
            i += 1;
            continue;
        }
        let Some((cid, cil)) = read_ebml_id(bytes, cdata) else {
            i += 1;
            continue;
        };
        if cid != 0xB3 {
            i += 1;
            continue;
        }
        let Some((Some(csz), csl)) = read_ebml_size(bytes, cdata + cil) else {
            i += 1;
            continue;
        };
        if !(1..=8).contains(&csz) {
            i += 1;
            continue;
        }
        let ct_data = cdata + cil + csl;
        let ct_end = ct_data + csz as usize;
        if ct_end > cend {
            i += 1;
            continue;
        }
        let next_is_track_pos = if ct_end < cend {
            read_ebml_id(bytes, ct_end)
                .map(|(nid, _)| nid == 0xB7)
                .unwrap_or(false)
        } else {
            false
        };
        if !next_is_track_pos {
            i += 1;
            continue;
        }
        if let Some(ticks) = read_ebml_uint_be(&bytes[ct_data..ct_end]) {
            let ts = (ticks as f64) * (ts_scale_ns as f64) / 1_000_000_000.0;
            if ts.is_finite()
                && ts >= 0.0
                && max_valid_sec.map(|m| ts <= m).unwrap_or(true)
            {
                count += 1;
                max_sec = Some(max_sec.map(|m| m.max(ts)).unwrap_or(ts));
                i = cend;
                continue;
            }
        }
        i += 1;
    }

    (count, max_sec)
}

fn classify_cues_coverage(
    cue_count: usize,
    max_cue_sec: Option<f64>,
    duration_sec: Option<f64>,
    truncated: bool,
) -> (bool, &'static str, Option<f64>) {
    if truncated || cue_count == 0 {
        return (false, "broken", None);
    }
    if let (Some(cov), Some(dur)) = (max_cue_sec, duration_sec) {
        if dur > 60.0 && cov < dur * 0.85 && (dur - cov) > 30.0 {
            return (false, "partial", Some(cov));
        }
    }
    (true, "valid", max_cue_sec)
}

async fn probe_secondary_seekhead_for_cues(
    client: &reqwest::Client,
    url: &str,
    headers: &HeaderMap,
    is_same_origin: bool,
    seekhead_offset: u64,
    total_size: u64,
    segment_data_start: u64,
) -> Option<u64> {
    if seekhead_offset >= total_size {
        return None;
    }
    let end = seekhead_offset.saturating_add(4095).min(total_size - 1);
    let rng = format!("bytes={seekhead_offset}-{end}");
    let req = apply_origin_safe_headers(client.get(url), headers, is_same_origin).header(RANGE, rng);
    let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(6), req.send()).await else {
        return None;
    };
    if !matches!(resp.status().as_u16(), 200 | 206) {
        return None;
    }
    let buf = read_limited_bytes(resp, 4096).await;
    let (id, il) = read_ebml_id(&buf, 0)?;
    if id != 0x114D_9B74 {
        return None;
    }
    let (sz_opt, sl) = read_ebml_size(&buf, il)?;
    let sh_data = il + sl;
    let sh_end = match sz_opt.and_then(|s| usize::try_from(s).ok()) {
        Some(s) => sh_data.saturating_add(s).min(buf.len()),
        None => buf.len(),
    };
    let (cues_off, _, _) = parse_seekhead_entries(&buf, sh_data, sh_end, segment_data_start);
    cues_off
}

async fn verify_mkv_cues_at_offset(
    client: &reqwest::Client,
    url: &str,
    headers: &HeaderMap,
    is_same_origin: bool,
    cues_offset: u64,
    total_size: u64,
    ts_scale_ns: u64,
    duration_sec: Option<f64>,
) -> (bool, &'static str, Option<f64>) {
    if cues_offset >= total_size {
        return (false, "broken", None);
    }
    let head_end = cues_offset.saturating_add(4095).min(total_size - 1);
    let head_rng = format!("bytes={cues_offset}-{head_end}");
    let req = apply_origin_safe_headers(client.get(url), headers, is_same_origin)
        .header(RANGE, head_rng);
    let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(6), req.send()).await else {
        return (false, "broken", None);
    };
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return (false, "broken", None);
    }
    let head_bytes = read_limited_bytes(resp, 4096).await;
    let Some((id, il)) = read_ebml_id(&head_bytes, 0) else {
        return (false, "broken", None);
    };
    if id != 0x1C53_BB6B {
        return (false, "broken", None);
    }
    let Some((sz_opt, sl)) = read_ebml_size(&head_bytes, il) else {
        return (false, "broken", None);
    };
    if sz_opt == Some(0) {
        return (false, "broken", None);
    }
    let hdr_len = (il + sl) as u64;
    let cues_end = sz_opt.map(|sz| cues_offset.saturating_add(hdr_len).saturating_add(sz));
    if cues_end.map(|e| e > total_size).unwrap_or(false) {
        return (false, "broken", None);
    }

    let max_valid_sec = duration_sec.map(|d| d * 1.15 + 30.0);
    let (head_count, mut max_sec) =
        extract_cue_points_max_time_sec(&head_bytes, ts_scale_ns, true, max_valid_sec);
    if head_count == 0 {
        return (false, "broken", None);
    }

    let fetched_end = cues_offset.saturating_add(head_bytes.len() as u64);
    if let Some(end_off) = cues_end.filter(|&e| e > fetched_end) {
        let tail_start = end_off
            .saturating_sub(4096)
            .max(cues_offset.saturating_add(hdr_len));
        if tail_start < end_off {
            let tail_rng = format!("bytes={tail_start}-{}", end_off - 1);
            let tail_req = apply_origin_safe_headers(client.get(url), headers, is_same_origin)
                .header(RANGE, tail_rng);
            if let Ok(Ok(tail_resp)) =
                tokio::time::timeout(Duration::from_secs(6), tail_req.send()).await
            {
                if tail_resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                    let tail_bytes = read_limited_bytes(tail_resp, 4096).await;
                    let (_tc, tail_max) = extract_cue_points_max_time_sec(
                        &tail_bytes,
                        ts_scale_ns,
                        false,
                        max_valid_sec,
                    );
                    if let Some(tm) = tail_max {
                        max_sec = Some(max_sec.map(|m| m.max(tm)).unwrap_or(tm));
                    }
                }
            }
        }
    }

    classify_cues_coverage(head_count, max_sec, duration_sec, false)
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
                mid_range_supported: None,
                total_size: None,
                is_mkv: false,
                has_mkv_cues: None,
                mkv_cues_status: None,
                mkv_cues_coverage_sec: None,
            });
        }
    };

    let mut current_url = origin_url.clone();
    let mut hops: Vec<DiagnosticHopDto> = Vec::new();
    let mut exceeded_redirects = false;
    let mut final_content_length: Option<u64> = None;

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
            crate::proxy::emit_observed_emby_host(
                request.url.as_str(),
                current_url.as_str(),
                if hop_idx == 1 { "stream" } else { "redirect" },
            );
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
                        crate::proxy::emit_observed_emby_host(
                            request.url.as_str(),
                            next_url.as_str(),
                            "redirect",
                        );
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

        final_content_length = resp.content_length();
        let is_html = content_type
            .as_deref()
            .map(|ct| ct.to_ascii_lowercase().contains("text/html"))
            .unwrap_or(false);
        let body_snippet = if status_code >= 400 || is_html {
            read_body_snippet(resp).await
        } else {
            None
        };

        if matches!(status_code, 200 | 206) {
            crate::proxy::emit_observed_emby_host(
                request.url.as_str(),
                current_url.as_str(),
                if hop_idx == 1 { "stream" } else { "redirect" },
            );
        }

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
    let final_ct_lower = last
        .and_then(|h| h.content_type.as_deref())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let final_is_html = final_ct_lower.contains("text/html");
    let reachable = matches!(final_status, Some(200 | 206)) && !final_is_html && !exceeded_redirects;

    let total_size = last
        .and_then(|h| h.content_range.as_deref())
        .and_then(|cr| parse_content_range_total(Some(cr)))
        .or(final_content_length);
    let mut mid_range_supported: Option<bool> = None;
    let mut is_mkv = final_ct_lower.contains("matroska");
    let mut has_mkv_cues: Option<bool> = None;
    let mut mkv_cues_status: Option<String> = None;
    let mut mkv_cues_coverage_sec: Option<f64> = None;

    if reachable && final_status == Some(206) {
        let is_same = same_origin(&origin_url, &current_url);
        let should_probe_head = is_mkv
            || final_ct_lower.contains("octet-stream")
            || current_url.path().to_ascii_lowercase().ends_with(".mkv");

        let mid_fut = async {
            if let Some(probe_total) = total_size.filter(|&sz| sz > 262_144) {
                let mid = probe_total / 2;
                let rng = format!("bytes={mid}-{}", mid + 1023);
                let req = apply_origin_safe_headers(
                    client.get(current_url.as_str()),
                    &header_map,
                    is_same,
                )
                .header(RANGE, rng);
                match tokio::time::timeout(Duration::from_secs(6), req.send()).await {
                    Ok(Ok(r)) => Some(r.status() == reqwest::StatusCode::PARTIAL_CONTENT),
                    _ => None,
                }
            } else {
                None
            }
        };

        let head_fut = async {
            if !should_probe_head {
                return Vec::new();
            }
            let req = apply_origin_safe_headers(
                client.get(current_url.as_str()),
                &header_map,
                is_same,
            )
            .header(RANGE, "bytes=0-131071");
            match tokio::time::timeout(Duration::from_secs(6), req.send()).await {
                Ok(Ok(r)) if matches!(r.status().as_u16(), 200 | 206) => {
                    read_limited_bytes(r, 131_072).await
                }
                _ => Vec::new(),
            }
        };

        let (mid_res, head_bytes) = tokio::join!(mid_fut, head_fut);
        mid_range_supported = mid_res;
        if head_bytes.len() >= 4 && head_bytes[0..4] == [0x1A, 0x45, 0xDF, 0xA3] {
            is_mkv = true;
            if let Some(info) = inspect_mkv_head_cues(&head_bytes) {
                let max_valid_sec = info.duration_sec.map(|d| d * 1.15 + 30.0);
                let verified: Option<(bool, &'static str, Option<f64>)> =
                    if let Some((start, end)) = info.inline_cues_range.filter(|_| info.inline_cues_complete) {
                        let (cnt, max_sec) = extract_cue_points_max_time_sec(
                            &head_bytes[start..end],
                            info.timestamp_scale_ns,
                            true,
                            max_valid_sec,
                        );
                        Some(classify_cues_coverage(cnt, max_sec, info.duration_sec, false))
                    } else if let Some(cues_off) = info.cues_abs_offset {
                        if let Some(ts) = total_size.filter(|_| mid_range_supported != Some(false)) {
                            Some(
                                verify_mkv_cues_at_offset(
                                    &client,
                                    current_url.as_str(),
                                    &header_map,
                                    is_same,
                                    cues_off,
                                    ts,
                                    info.timestamp_scale_ns,
                                    info.duration_sec,
                                )
                                .await,
                            )
                        } else if total_size.map(|ts| cues_off >= ts).unwrap_or(false) {
                            Some((false, "broken", None))
                        } else {
                            None
                        }
                    } else if info.cues_seek_without_pos {
                        Some((false, "broken", None))
                    } else if let (Some(sec_sh), Some(ts)) = (
                        info.secondary_seekhead_offset,
                        total_size.filter(|_| mid_range_supported != Some(false)),
                    ) {
                        if let Some(cues_off) = probe_secondary_seekhead_for_cues(
                            &client,
                            current_url.as_str(),
                            &header_map,
                            is_same,
                            sec_sh,
                            ts,
                            info.segment_data_start,
                        )
                        .await
                        {
                            Some(
                                verify_mkv_cues_at_offset(
                                    &client,
                                    current_url.as_str(),
                                    &header_map,
                                    is_same,
                                    cues_off,
                                    ts,
                                    info.timestamp_scale_ns,
                                    info.duration_sec,
                                )
                                .await,
                            )
                        } else if info.reached_first_cluster {
                            Some((false, "missing", None))
                        } else {
                            None
                        }
                    } else if info.reached_first_cluster {
                        Some((false, "missing", None))
                    } else {
                        None
                    };

                if let Some((valid, status_str, cov)) = verified {
                    has_mkv_cues = Some(valid);
                    mkv_cues_status = Some(status_str.to_string());
                    mkv_cues_coverage_sec = cov;
                }
            }
        }
    } else if reachable && final_status == Some(200) {
        mid_range_supported = Some(false);
    }

    let summary = if reachable && mid_range_supported == Some(false) {
        "上游不支持中段 HTTP Range 跳转（返回 HTTP 200），建议从 00:00 播放".to_string()
    } else {
        summarize_diagnostic_outcome(exceeded_redirects, reachable, last, final_status, final_is_html)
    };

    Ok(StreamDiagnosticReport {
        reachable,
        final_status,
        user_agent,
        summary,
        hops,
        mid_range_supported,
        total_size,
        is_mkv,
        has_mkv_cues,
        mkv_cues_status,
        mkv_cues_coverage_sec,
    })
}

struct MkvSliceHead {
    head_prefix: Vec<u8>,
    first_cluster_offset: u64,
    timestamp_scale_ns: u64,
    duration_sec: Option<f64>,
}

/// 解析 MKV 头部并生成切片前缀：将 Segment Size 改为 Unknown Size，并原地 Void 化旧 SeekHead/Cues 防止越界寻址。
fn parse_mkv_slice_head(bytes: &[u8]) -> Option<MkvSliceHead> {
    if bytes.len() < 16 || bytes[0..4] != [0x1A, 0x45, 0xDF, 0xA3] {
        return None;
    }
    let (ebml_id, id_len) = read_ebml_id(bytes, 0)?;
    if ebml_id != 0x1A45_DFA3 {
        return None;
    }
    let (ebml_sz, sz_len) = read_ebml_size(bytes, id_len)?;
    let mut pos = id_len + sz_len + usize::try_from(ebml_sz?).ok()?;

    let (seg_size_pos, seg_size_len, seg_end) = loop {
        if pos >= bytes.len() {
            return None;
        }
        let (id, il) = read_ebml_id(bytes, pos)?;
        let (sz_opt, sl) = read_ebml_size(bytes, pos + il)?;
        let data_start = pos + il + sl;
        if id == 0x1853_8067 {
            let sp = pos + il;
            pos = data_start;
            let end = match sz_opt.and_then(|s| usize::try_from(s).ok()) {
                Some(s) => data_start.saturating_add(s).min(bytes.len()),
                None => bytes.len(),
            };
            break (sp, sl, end);
        }
        let skip = usize::try_from(sz_opt?).ok()?;
        pos = data_start.checked_add(skip)?;
    };

    let mut ts_scale_ns: u64 = 1_000_000;
    let mut duration_ticks: Option<f64> = None;
    let mut first_cluster_offset: Option<usize> = None;
    let mut void_ranges: Vec<(usize, usize)> = Vec::new();

    while pos < seg_end {
        let Some((id, il)) = read_ebml_id(bytes, pos) else {
            break;
        };
        let Some((sz_opt, sl)) = read_ebml_size(bytes, pos + il) else {
            break;
        };
        let data_start = pos + il + sl;
        if id == 0x1F43_B675 {
            first_cluster_offset = Some(pos);
            break;
        }
        let Some(sz) = sz_opt.and_then(|s| usize::try_from(s).ok()) else {
            break;
        };
        let raw_end = data_start.saturating_add(sz);
        if raw_end > seg_end {
            break;
        }
        let elem_end = raw_end;
        if id == 0x114D_9B74 || id == 0x1C53_BB6B {
            void_ranges.push((pos, elem_end));
        } else if id == 0x1549_A966 {
            // Info: 读取 TimestampScale (0x2AD7B1) 与 Duration (0x4489)
            let mut ip = data_start;
            while ip < elem_end {
                let Some((iid, iil)) = read_ebml_id(bytes, ip) else {
                    break;
                };
                let Some((isz_opt, isl)) = read_ebml_size(bytes, ip + iil) else {
                    break;
                };
                let idata = ip + iil + isl;
                let Some(isz) = isz_opt.and_then(|s| usize::try_from(s).ok()) else {
                    break;
                };
                let iend = idata.saturating_add(isz).min(elem_end);
                if iid == 0x2AD7_B1 {
                    if let Some(v) = read_ebml_uint_be(&bytes[idata..iend]).filter(|&v| v > 0) {
                        ts_scale_ns = v;
                    }
                } else if iid == 0x4489 {
                    if let Some(d) = read_ebml_float_be(&bytes[idata..iend]).filter(|d| d.is_finite() && *d > 0.0) {
                        duration_ticks = Some(d);
                    }
                }
                ip = iend;
            }
        }
        pos = elem_end;
    }

    let first_cluster = first_cluster_offset?;
    if first_cluster <= seg_size_pos + seg_size_len || first_cluster > 2 * 1024 * 1024 {
        return None;
    }

    let mut head_prefix = bytes[..first_cluster].to_vec();
    // 原地将 Segment Size 改为同宽度 Unknown Size，并 Void 化旧 SeekHead / Cues，保证其余偏移 0 变动
    head_prefix[seg_size_pos] = if seg_size_len == 8 {
        0x01
    } else {
        (1u8 << (8 - seg_size_len)) | ((1u8 << (8 - seg_size_len)) - 1)
    };
    for b in &mut head_prefix[seg_size_pos + 1..seg_size_pos + seg_size_len] {
        *b = 0xFF;
    }
    for (s, e) in void_ranges {
        if e <= head_prefix.len() {
            write_ebml_void_in_place(&mut head_prefix[s..e]);
        }
    }

    let duration_sec = duration_ticks.map(|t| (t * ts_scale_ns as f64) / 1_000_000_000.0);
    Some(MkvSliceHead {
        head_prefix,
        first_cluster_offset: first_cluster as u64,
        timestamp_scale_ns: ts_scale_ns,
        duration_sec,
    })
}

fn is_valid_cluster_child_id(id: u32) -> bool {
    matches!(
        id,
        0xA3 | 0xA0 | 0xA7 | 0xAB | 0xBF | 0x5854 | 0xEC | 0xE7
    )
}

/// 4 重严格校验定位窗口内首个合法 Matroska Cluster（0x1F43B675）的绝对偏移与真实时间戳（秒）。
fn find_first_cluster_in_slice(
    buf: &[u8],
    base_offset: u64,
    ts_scale_ns: u64,
    max_valid_sec: f64,
) -> Option<(u64, f64)> {
    if buf.len() < 16 {
        return None;
    }
    let mut i = 0usize;
    while i + 12 <= buf.len() {
        if buf[i] != 0x1F
            || buf[i + 1] != 0x43
            || buf[i + 2] != 0xB6
            || buf[i + 3] != 0x75
        {
            i += 1;
            continue;
        }
        // 校验 1：合法 Cluster Size VINT
        let Some((cl_sz_opt, sz_len)) = read_ebml_size(buf, i + 4) else {
            i += 1;
            continue;
        };
        if let Some(sz) = cl_sz_opt {
            if !(16..128 * 1024 * 1024).contains(&sz) {
                i += 1;
                continue;
            }
        }
        // 校验 2~4：Cluster 头部子元素中存在合法 Timestamp (0xE7)，值在有效范围内，且紧随合法 Cluster 子元素 ID
        let mut cpos = i + 4 + sz_len;
        for _ in 0..6 {
            let Some((cid, cil)) = read_ebml_id(buf, cpos) else {
                break;
            };
            let Some((csz_opt, csl)) = read_ebml_size(buf, cpos + cil) else {
                break;
            };
            let cdata = cpos + cil + csl;
            let Some(csz) = csz_opt.and_then(|s| usize::try_from(s).ok()) else {
                break;
            };
            let cend = cdata.saturating_add(csz);
            if cend > buf.len() {
                break;
            }
            if cid == 0xE7 {
                if let Some(ticks) = read_ebml_uint_be(&buf[cdata..cend]) {
                    let ts_sec = (ticks as f64) * (ts_scale_ns as f64) / 1_000_000_000.0;
                    if ts_sec.is_finite() && ts_sec >= 0.0 && ts_sec <= max_valid_sec {
                        let next_ok = if cend + 1 < buf.len() {
                            read_ebml_id(buf, cend)
                                .map(|(nid, _)| is_valid_cluster_child_id(nid))
                                .unwrap_or(false)
                        } else {
                            true
                        };
                        if next_ok {
                            return Some((base_offset.saturating_add(i as u64), ts_sec));
                        }
                    }
                }
                break;
            }
            if !is_valid_cluster_child_id(cid) || csz > 1024 * 1024 {
                break;
            }
            cpos = cend;
        }
        i += 1;
    }
    None
}

async fn stream_probe_cluster_at(
    client: &reqwest::Client,
    origin_url: &str,
    headers: &HeaderMap,
    resolved_cache: &RwLock<Option<ResolvedTargetCache>>,
    probe_offset: u64,
    total_size: u64,
    ts_scale_ns: u64,
    max_valid_sec: f64,
) -> Option<(u64, f64)> {
    if probe_offset >= total_size {
        return None;
    }
    let window_len = (4 * 1024 * 1024u64).min(total_size - probe_offset);
    let end = probe_offset + window_len - 1;
    let rng = format!("bytes={probe_offset}-{end}");
    let Ok((mut resp, _)) = tokio::time::timeout(
        Duration::from_secs(6),
        send_with_cached_redirects(client, origin_url, headers, Some(&rng), false, resolved_cache),
    )
    .await
    .ok()?
    else {
        return None;
    };
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return None;
    }

    let max_bytes = window_len as usize;
    let mut buf: Vec<u8> = Vec::with_capacity(256 * 1024);
    let mut scan_from = 0usize;
    while buf.len() < max_bytes {
        match tokio::time::timeout(Duration::from_secs(4), resp.chunk()).await {
            Ok(Ok(Some(chunk))) => {
                let take = (max_bytes - buf.len()).min(chunk.len());
                buf.extend_from_slice(&chunk[..take]);
                if let Some(found) = find_first_cluster_in_slice(
                    &buf[scan_from..],
                    probe_offset.saturating_add(scan_from as u64),
                    ts_scale_ns,
                    max_valid_sec,
                ) {
                    // 命中首个合法 Cluster 立即 drop(resp) 释放上游连接，最小化探测流量
                    return Some(found);
                }
                scan_from = buf.len().saturating_sub(64);
                if take < chunk.len() {
                    break;
                }
            }
            _ => break,
        }
    }
    None
}

/// 插值二分定位目标时间之前最近的合法 MKV Cluster，最多 6 轮流式早停小 Range 请求。
async fn locate_mkv_cluster_for_time(
    client: &reqwest::Client,
    origin_url: &str,
    headers: &HeaderMap,
    resolved_cache: &RwLock<Option<ResolvedTargetCache>>,
    target_sec: f64,
    fallback_duration_sec: Option<f64>,
) -> Option<MkvSliceOverlay> {
    if !target_sec.is_finite() || target_sec < 25.0 {
        return None;
    }

    // 1. 拉取前 128 KB 解析文件头；若内嵌字体/附件导致头部超过 128 KB，自动回退拉取 1 MB
    let (head_resp, _) = send_with_cached_redirects(
        client,
        origin_url,
        headers,
        Some("bytes=0-131071"),
        false,
        resolved_cache,
    )
    .await
    .ok()?;
    if head_resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return None;
    }
    let total_size = head_resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| parse_content_range_total(Some(s)))?;
    if total_size < 4 * 1024 * 1024 {
        return None;
    }
    let head_bytes = read_limited_bytes(head_resp, 131_072).await;
    let slice_head = match parse_mkv_slice_head(&head_bytes) {
        Some(h) => h,
        None if head_bytes.len() >= 131_072 && total_size > 131_072 => {
            let ext_end = total_size.min(1_048_576) - 1;
            let ext_rng = format!("bytes=0-{ext_end}");
            let (ext_resp, _) = send_with_cached_redirects(
                client,
                origin_url,
                headers,
                Some(&ext_rng),
                false,
                resolved_cache,
            )
            .await
            .ok()?;
            if !matches!(ext_resp.status().as_u16(), 200 | 206) {
                return None;
            }
            let ext_bytes = read_limited_bytes(ext_resp, 1_048_576).await;
            parse_mkv_slice_head(&ext_bytes)?
        }
        None => return None,
    };

    let duration_sec = slice_head
        .duration_sec
        .or(fallback_duration_sec)
        .filter(|d| d.is_finite() && *d > 25.0)?;
    if target_sec >= duration_sec - 2.0 {
        return None;
    }

    let max_valid_sec = duration_sec * 1.15 + 30.0;
    let mut lo_off = slice_head.first_cluster_offset;
    let mut lo_ts = 0.0f64;
    let mut hi_off = total_size;
    let mut hi_ts = duration_sec;
    let aim_sec = (target_sec - 6.0).max(0.0);
    let mut best_before: Option<(u64, f64)> = None;
    let mut best_after: Option<(u64, f64)> = None;

    // 2. 最多 6 轮插值二分，收敛至目标时间前 0~12 秒窗口内（宁早勿晚，绝不跳过未看剧情）
    for _round in 0..6 {
        if hi_off <= lo_off.saturating_add(512 * 1024) || hi_ts <= lo_ts + 1.0 {
            break;
        }
        let ratio = ((aim_sec - lo_ts) / (hi_ts - lo_ts)).clamp(0.04, 0.96);
        let probe_off = lo_off + ((hi_off - lo_off) as f64 * ratio) as u64;
        let Some((cl_off, cl_ts)) = stream_probe_cluster_at(
            client,
            origin_url,
            headers,
            resolved_cache,
            probe_off,
            total_size,
            slice_head.timestamp_scale_ns,
            max_valid_sec,
        )
        .await
        else {
            break;
        };

        if cl_ts <= target_sec {
            if best_before.map(|(_, t)| cl_ts > t).unwrap_or(true) {
                best_before = Some((cl_off, cl_ts));
            }
            if target_sec - cl_ts <= 12.0 {
                break;
            }
            if cl_off > lo_off {
                lo_off = cl_off;
                lo_ts = cl_ts;
            } else {
                break;
            }
        } else {
            if best_after.map(|(_, t)| cl_ts < t).unwrap_or(true) {
                best_after = Some((cl_off, cl_ts));
            }
            if cl_off < hi_off {
                hi_off = cl_off;
                hi_ts = cl_ts;
            } else if probe_off < hi_off && probe_off > lo_off {
                // 4 MB 探测窗向后跨过 hi_off 时，仍收缩上界至 probe_off 避免过早放弃
                hi_off = probe_off;
                hi_ts = hi_ts.min(cl_ts);
            } else {
                break;
            }
        }
    }

    if best_before.is_none() && hi_off > lo_off.saturating_add(512 * 1024) {
        let mid_off = lo_off + (hi_off - lo_off) / 2;
        if let Some((cl_off, cl_ts)) = stream_probe_cluster_at(
            client,
            origin_url,
            headers,
            resolved_cache,
            mid_off,
            total_size,
            slice_head.timestamp_scale_ns,
            max_valid_sec,
        )
        .await
        {
            if cl_ts <= target_sec {
                best_before = Some((cl_off, cl_ts));
            } else if best_after.map(|(_, t)| cl_ts < t).unwrap_or(true) {
                best_after = Some((cl_off, cl_ts));
            }
        }
    }

    let (cut_offset, slice_start_sec) = best_before
        .or_else(|| best_after.filter(|(_, ts)| *ts - target_sec <= 8.0))?;
    // 安全门控：至少跳过 1 MiB 才启用切片
    let min_meaningful_cut = slice_head
        .first_cluster_offset
        .saturating_add(1 * 1024 * 1024);
    if cut_offset <= min_meaningful_cut || cut_offset >= total_size {
        return None;
    }

    let virtual_total_size =
        (slice_head.head_prefix.len() as u64).saturating_add(total_size - cut_offset);
    Some(MkvSliceOverlay {
        head_prefix: slice_head.head_prefix,
        upstream_cut_offset: cut_offset,
        virtual_total_size,
        slice_start_sec,
    })
}

#[tauri::command]
pub async fn start_stream_relay(request: StartRelayRequest) -> Result<StartedRelayDto, String> {
    let (user_agent, header_map) = parse_request_headers(request.headers);
    let client = build_no_redirect_http_client(request.proxy_url.as_deref(), &user_agent)?;
    let token = Uuid::new_v4().to_string();
    let resolved_target = RwLock::new(None);

    let slice = if let Some(target_sec) = request
        .slice_target_sec
        .filter(|s| s.is_finite() && *s >= 25.0)
    {
        tokio::time::timeout(
            Duration::from_secs(18),
            locate_mkv_cluster_for_time(
                &client,
                &request.url,
                &header_map,
                &resolved_target,
                target_sec,
                request.duration_sec,
            ),
        )
        .await
        .ok()
        .flatten()
    } else {
        None
    };

    let sliced = slice.is_some();
    let slice_start_sec = slice.as_ref().map(|s| s.slice_start_sec);

    let session = Arc::new(RelaySession {
        token: token.clone(),
        upstream_url: request.url,
        client,
        headers: header_map,
        resolved_target,
        slice,
        transfer: StreamTransferTracker::default(),
    });

    {
        let mut guard = manager()
            .inner
            .write()
            .map_err(|_| "PreloadManager 锁异常".to_string())?;
        guard.relay = Some(session);
    }

    let port = ensure_proxy_server_started().await?;
    let local_url = format!("http://127.0.0.1:{port}/relay/{token}");
    Ok(StartedRelayDto {
        token,
        local_url,
        sliced,
        slice_start_sec,
    })
}

#[tauri::command]
pub async fn get_stream_transfer_stats(
    token: String,
) -> Result<Option<StreamTransferStatsDto>, String> {
    if let Some(relay) = find_relay_by_token(&token) {
        return Ok(Some(relay.transfer.to_dto(&token)));
    }
    if let Some(session) = find_session_by_token(&token) {
        return Ok(Some(session.transfer.to_dto(&token)));
    }
    Ok(None)
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

    #[test]
    fn test_summarize_diagnostic_outcome_cloudflare_530_and_522() {
        let hop_530 = DiagnosticHopDto {
            hop: 1,
            url: "https://node.example.com/d/test.mkv?sign=***".to_string(),
            status: Some(530),
            status_text: None,
            location: None,
            server: Some("cloudflare".to_string()),
            content_type: Some("text/plain; charset=UTF-8".to_string()),
            content_range: None,
            accept_ranges: None,
            cf_ray: Some("abc-LHR".to_string()),
            cf_mitigated: None,
            body_snippet: Some("error code: 1033".to_string()),
            error: None,
        };
        let summary_530 = summarize_diagnostic_outcome(false, false, Some(&hop_530), Some(530), false);
        assert!(summary_530.contains("530"));
        assert!(summary_530.contains("1033"));
        assert!(summary_530.contains(".strm"));

        let hop_522 = DiagnosticHopDto {
            status: Some(522),
            body_snippet: None,
            ..hop_530
        };
        let summary_522 = summarize_diagnostic_outcome(false, false, Some(&hop_522), Some(522), false);
        assert!(summary_522.contains("522"));
        assert!(summary_522.contains("Cloudflare"));
    }

    #[test]
    fn test_should_keep_alive_and_proxy_client_accepts_socks5() {
        assert!(should_keep_alive("HTTP/1.1", None));
        assert!(should_keep_alive("HTTP/1.1", Some("keep-alive")));
        assert!(!should_keep_alive("HTTP/1.1", Some("close")));
        assert!(!should_keep_alive("HTTP/1.0", None));
        assert!(should_keep_alive("HTTP/1.0", Some("keep-alive")));

        assert!(build_no_redirect_http_client(Some("socks5://127.0.0.1:10808"), "Nocta").is_ok());
        assert!(build_no_redirect_http_client(Some("http://127.0.0.1:7890"), "Nocta").is_ok());
    }

    #[test]
    fn test_stream_transfer_tracker_caps_recent_requests_at_8() {
        let tracker = StreamTransferTracker::default();
        tracker.add_bytes(1024);
        tracker.add_bytes(2048);
        for i in 0..10 {
            tracker.record_request(
                "GET",
                206,
                Some(&format!("bytes={i}-")),
                Some(&format!("bytes {i}-99/100")),
            );
        }
        let dto = tracker.to_dto("tok-1");
        assert_eq!(dto.token, "tok-1");
        assert_eq!(dto.bytes_sent, 3072);
        assert_eq!(dto.request_count, 10);
        assert_eq!(dto.recent_requests.len(), 8);
        assert!(dto.recent_requests[0].contains("bytes=2-"));
        assert!(dto.recent_requests[7].contains("bytes=9-"));
    }

    #[test]
    fn test_write_ebml_void_in_place_exact_lengths() {
        for len in [2usize, 3, 15, 128, 129, 250, 20000] {
            let mut buf = vec![0xAAu8; len];
            assert!(write_ebml_void_in_place(&mut buf), "len={len} should succeed");
            let (id, il) = read_ebml_id(&buf, 0).expect("valid Void ID");
            assert_eq!(id, 0xEC);
            let (sz, sl) = read_ebml_size(&buf, il).expect("valid Void size");
            assert_eq!(il + sl + (sz.unwrap() as usize), len);
        }
        let mut too_short = vec![0xAAu8; 1];
        assert!(!write_ebml_void_in_place(&mut too_short));
    }

    #[test]
    fn test_inspect_mkv_head_cues_extracts_seek_position_and_validates_cues_block() {
        assert!(inspect_mkv_head_cues(b"not an mkv file").is_none());

        // 1. SeekHead 指向 SeekID=Cues + SeekPosition=500000 -> 解析为 segment_data_start + 500000
        let pos_bytes = 500_000u32.to_be_bytes();
        let seek_head_cues: Vec<u8> = vec![
            0x1A, 0x45, 0xDF, 0xA3, 0x80, // EBML len=0 (5 bytes)
            0x18, 0x53, 0x80, 0x67, 0xFF, // Segment unknown len (5 bytes -> segment_data_start=10)
            0x11, 0x4D, 0x9B, 0x74, 0x91, // SeekHead len=17
            0x4D, 0xBB, 0x8E, // Seek len=14
            0x53, 0xAB, 0x84, 0x1C, 0x53, 0xBB, 0x6B, // SeekID = Cues (7 bytes)
            0x53, 0xAC, 0x84, pos_bytes[0], pos_bytes[1], pos_bytes[2], pos_bytes[3], // SeekPosition (7 bytes)
            0x1F, 0x43, 0xB6, 0x75, 0x80, // Cluster
        ];
        let info = inspect_mkv_head_cues(&seek_head_cues).expect("should inspect");
        assert_eq!(info.segment_data_start, 10);
        assert_eq!(info.cues_abs_offset, Some(500_010));
        assert!(info.reached_first_cluster);

        // 2. 空 Cues 块（0 CuePoint）应判为 broken
        let empty_cues = vec![0x1C, 0x53, 0xBB, 0x6B, 0x80];
        let (cnt0, max0) = extract_cue_points_max_time_sec(&empty_cues, 1_000_000, true, None);
        assert_eq!(classify_cues_coverage(cnt0, max0, Some(1800.0), false), (false, "broken", None));

        // 3. 构建合法 Cues（覆盖至 1750s / 总长 1800s -> valid；仅至 600s / 总长 1800s -> partial）
        let build_cue_point = |ms: u32| -> Vec<u8> {
            let b = ms.to_be_bytes();
            vec![
                0xBB, 0x8B, // CuePoint len=11
                0xB3, 0x84, b[0], b[1], b[2], b[3], // CueTime len=4
                0xB7, 0x83, 0xF7, 0x81, 0x01, // CueTrackPositions
            ]
        };
        let mut partial_cues = vec![0x1C, 0x53, 0xBB, 0x6B, 0x9A]; // Cues len=26 (2 CuePoints)
        partial_cues.extend_from_slice(&build_cue_point(10_000));
        partial_cues.extend_from_slice(&build_cue_point(600_000));
        let (cnt_p, max_p) = extract_cue_points_max_time_sec(&partial_cues, 1_000_000, true, Some(2100.0));
        assert_eq!(cnt_p, 2);
        let (valid_p, status_p, cov_p) = classify_cues_coverage(cnt_p, max_p, Some(1800.0), false);
        assert!(!valid_p);
        assert_eq!(status_p, "partial");
        assert!((cov_p.unwrap() - 600.0).abs() < 0.01);

        // 尾部切片扫描命中 1750s -> valid
        let tail_chunk = build_cue_point(1_750_000);
        let (cnt_t, max_t) = extract_cue_points_max_time_sec(&tail_chunk, 1_000_000, false, Some(2100.0));
        assert_eq!(cnt_t, 1);
        let (valid_v, status_v, _) = classify_cues_coverage(cnt_p + cnt_t, max_t, Some(1800.0), false);
        assert!(valid_v);
        assert_eq!(status_v, "valid");

        // 4. 无 Cues 且无 SeekHead 指向 Cues -> reached_first_cluster=true, cues_abs_offset=None
        let no_cues: Vec<u8> = vec![
            0x1A, 0x45, 0xDF, 0xA3, 0x80,
            0x18, 0x53, 0x80, 0x67, 0xFF,
            0x15, 0x49, 0xA9, 0x66, 0x80,
            0x1F, 0x43, 0xB6, 0x75, 0x80,
        ];
        let info_missing = inspect_mkv_head_cues(&no_cues).expect("should inspect");
        assert!(info_missing.reached_first_cluster);
        assert!(info_missing.cues_abs_offset.is_none());
        assert!(info_missing.inline_cues_range.is_none());
    }

    #[test]
    fn test_parse_mkv_slice_head_voids_seekhead_and_cues_in_place() {
        // EBML (empty) + Segment (fixed 2-byte size) + SeekHead + Info + Cues + Cluster
        let dur_bytes = (1_827_000.0f32).to_be_bytes();
        let seekhead = vec![
            0x11, 0x4D, 0x9B, 0x74, 0x8A, // SeekHead len=10 (total 15 bytes)
            0x4D, 0xBB, 0x87,
            0x53, 0xAB, 0x84, 0x1C, 0x53, 0xBB, 0x6B,
        ];
        let info = vec![
            0x15, 0x49, 0xA9, 0x66, 0x8E, // Info len=14 (total 19 bytes)
            0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40,
            0x44, 0x89, 0x84, dur_bytes[0], dur_bytes[1], dur_bytes[2], dur_bytes[3],
        ];
        let inline_cues = vec![0x1C, 0x53, 0xBB, 0x6B, 0x83, 0xAA, 0xBB, 0xCC]; // total 8 bytes
        let seg_payload_len = (seekhead.len() + info.len() + inline_cues.len() + 6) as u16;
        let seg_sz_bytes = (seg_payload_len | 0x4000).to_be_bytes();

        let mut mkv: Vec<u8> = vec![
            0x1A, 0x45, 0xDF, 0xA3, 0x80, // EBML len=0 (5 bytes)
            0x18, 0x53, 0x80, 0x67, seg_sz_bytes[0], seg_sz_bytes[1], // Segment (6 bytes)
        ];
        let sh_start = mkv.len();
        mkv.extend_from_slice(&seekhead);
        let info_start = mkv.len();
        mkv.extend_from_slice(&info);
        let cues_start = mkv.len();
        mkv.extend_from_slice(&inline_cues);
        let cluster_start = mkv.len();
        mkv.extend_from_slice(&[0x1F, 0x43, 0xB6, 0x75, 0x90, 0xE7, 0x81, 0x00]);

        let parsed = parse_mkv_slice_head(&mkv).expect("should parse slice head");
        assert_eq!(parsed.first_cluster_offset, cluster_start as u64);
        assert_eq!(parsed.head_prefix.len(), cluster_start);
        assert_eq!(parsed.timestamp_scale_ns, 1_000_000);
        assert!((parsed.duration_sec.unwrap() - 1827.0).abs() < 0.5);
        // Segment size VINT (2 bytes at 9..11) -> unknown size
        assert_eq!(read_ebml_size(&parsed.head_prefix, 9), Some((None, 2)));
        // SeekHead 与 Cues 均原地替换为等长 Void (0xEC)，Info 原封不动
        assert_eq!(read_ebml_id(&parsed.head_prefix, sh_start), Some((0xEC, 1)));
        assert_eq!(read_ebml_id(&parsed.head_prefix, cues_start), Some((0xEC, 1)));
        assert_eq!(
            &parsed.head_prefix[info_start..info_start + info.len()],
            &info[..]
        );
    }

    #[test]
    fn test_find_first_cluster_in_slice_validates_and_rejects_false_magic() {
        let mut buf: Vec<u8> = vec![0xAA; 8];
        // False positive magic inside compressed payload (garbage child ID 0x99)
        buf.extend_from_slice(&[0x1F, 0x43, 0xB6, 0x75, 0x90, 0x99, 0x81, 0x00]);
        // Real Cluster at offset 16: size=24 (0x98), Timestamp=1_674_000 ms (0x198B30), followed by SimpleBlock (0xA3)
        let real_off = buf.len();
        buf.extend_from_slice(&[
            0x1F, 0x43, 0xB6, 0x75, 0x98, // Cluster len=24
            0xE7, 0x83, 0x19, 0x8B, 0x10, // Timestamp = 1674000 ms (0x198B10) = 1674.0s
            0xA3, 0x84, 0x81, 0x00, 0x00, 0x80, // SimpleBlock
        ]);
        let found = find_first_cluster_in_slice(&buf, 800_000_000, 1_000_000, 2100.0)
            .expect("should find real cluster after skipping false magic");
        assert_eq!(found.0, 800_000_000 + real_off as u64);
        assert!((found.1 - 1674.0).abs() < 0.01);
    }
}
