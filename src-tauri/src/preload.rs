use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

use crate::mkv_cues::{
    build_virtual_mkv_patch, cues_cover_duration, extract_cluster_cue_from_window,
    extract_last_cluster_cue_from_window, find_cues_in_slice, inspect_mkv_head, is_ebml_mkv,
    map_virtual_range, VirtualMkvOverlay, VirtualRangeSegment,
};

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
    pub mkv_head_summary: Option<String>,
    pub file_truncated: bool,
    pub expected_size: Option<u64>,
    pub max_playable_sec: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRelayRequest {
    pub url: String,
    pub proxy_url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub initial_time_sec: Option<f64>,
    #[serde(default)]
    pub duration_sec: Option<f64>,
    #[serde(default)]
    pub enable_mkv_virtual_cues: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedRelayDto {
    pub token: String,
    pub local_url: String,
    pub virtual_cues_active: bool,
    pub virtual_cues_count: usize,
    pub virtual_cues_reason: Option<String>,
    pub file_truncated: bool,
    pub expected_size: Option<u64>,
    pub max_playable_sec: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStatsDto {
    pub token: String,
    pub bytes_sent: u64,
    pub request_count: u64,
    pub last_status: Option<u16>,
    pub last_range: Option<String>,
    pub last_content_range: Option<String>,
    pub last_error: Option<String>,
    pub virtual_cues_active: bool,
    pub virtual_cues_count: usize,
    pub virtual_cues_reason: Option<String>,
    pub file_truncated: bool,
    pub expected_size: Option<u64>,
    pub max_playable_sec: Option<f64>,
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

#[derive(Default)]
struct RelayTelemetry {
    last_range: Option<String>,
    last_content_range: Option<String>,
    last_error: Option<String>,
    recent_requests: Vec<String>,
}

struct RelaySession {
    token: String,
    upstream_url: String,
    client: reqwest::Client,
    headers: HeaderMap,
    resolved_target: RwLock<Option<ResolvedTargetCache>>,
    virtual_mkv: Option<VirtualMkvOverlay>,
    virtual_cues_reason: Option<String>,
    file_truncated: bool,
    expected_size: Option<u64>,
    max_playable_sec: Option<f64>,
    bytes_sent: AtomicU64,
    request_count: AtomicU64,
    last_status: AtomicU16,
    telemetry: RwLock<RelayTelemetry>,
}

impl RelaySession {
    fn record_request(
        &self,
        method: &str,
        status: u16,
        range_hdr: Option<&str>,
        content_range: Option<&str>,
    ) {
        self.request_count.fetch_add(1, Ordering::Relaxed);
        self.last_status.store(status, Ordering::Relaxed);
        if let Ok(mut guard) = self.telemetry.write() {
            guard.last_range = range_hdr.map(str::to_string);
            guard.last_content_range = content_range.map(str::to_string);
            let entry = format!(
                "{} {} -> HTTP {}{}",
                method,
                range_hdr.unwrap_or("(no Range)"),
                status,
                content_range
                    .map(|cr| format!(" [{cr}]"))
                    .unwrap_or_default()
            );
            guard.recent_requests.push(entry);
            if guard.recent_requests.len() > 10 {
                let overflow = guard.recent_requests.len() - 10;
                guard.recent_requests.drain(0..overflow);
            }
        }
    }

    fn record_error(&self, err: String) {
        if let Ok(mut guard) = self.telemetry.write() {
            guard.last_error = Some(err);
        }
    }

    fn to_stats_dto(&self) -> RelayStatsDto {
        let status_raw = self.last_status.load(Ordering::Relaxed);
        let (last_range, last_content_range, last_error, recent_requests) = self
            .telemetry
            .read()
            .map(|t| {
                (
                    t.last_range.clone(),
                    t.last_content_range.clone(),
                    t.last_error.clone(),
                    t.recent_requests.clone(),
                )
            })
            .unwrap_or_default();
        RelayStatsDto {
            token: self.token.clone(),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            request_count: self.request_count.load(Ordering::Relaxed),
            last_status: if status_raw > 0 { Some(status_raw) } else { None },
            last_range,
            last_content_range,
            last_error,
            virtual_cues_active: self.virtual_mkv.is_some(),
            virtual_cues_count: self.virtual_mkv.as_ref().map(|v| v.cue_count).unwrap_or(0),
            virtual_cues_reason: self.virtual_cues_reason.clone(),
            file_truncated: self.file_truncated,
            expected_size: self.expected_size,
            max_playable_sec: self.max_playable_sec,
            recent_requests,
        }
    }
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
    let (status_line, req_start, req_end, content_range_hdr) =
        match parse_http_range(range_header.as_deref(), total_size) {
            RangeParseResult::None => ("HTTP/1.1 200 OK", 0, total_size - 1, None),
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
                return Ok(false);
            }
        };

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

async fn handle_virtual_mkv_relay(
    stream: &mut TcpStream,
    session: &RelaySession,
    overlay: &VirtualMkvOverlay,
    method: &str,
    range_header: Option<&str>,
    keep_alive: bool,
) -> Result<bool, ()> {
    let is_head = method.eq_ignore_ascii_case("HEAD");
    let total_size = overlay.virtual_total_size;
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
                session.record_request(method, 416, range_header, None);
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
    session.record_request(method, status_code, range_header, cr_clean);

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

    for seg in map_virtual_range(overlay, req_start, req_end) {
        match seg {
            VirtualRangeSegment::MemorySlice { start, end } => {
                let slice = &overlay.prefix_bytes[start..end];
                if stream.write_all(slice).await.is_err() {
                    return Ok(false);
                }
                session
                    .bytes_sent
                    .fetch_add(slice.len() as u64, Ordering::Relaxed);
            }
            VirtualRangeSegment::UpstreamRange { start, end } => {
                let range_val = format!("bytes={start}-{end}");
                let mut resp = match send_with_cached_redirects(
                    &session.client,
                    &session.upstream_url,
                    &session.headers,
                    Some(&range_val),
                    false,
                    &session.resolved_target,
                )
                .await
                {
                    Ok((r, _)) => r,
                    Err(e) => {
                        session.record_error(e);
                        return Ok(false);
                    }
                };

                let up_status = resp.status();
                if up_status != reqwest::StatusCode::PARTIAL_CONTENT
                    && !(start == 0 && up_status.is_success())
                {
                    session.record_error(format!(
                        "虚拟索引上游分段请求 {range_val} 返回异常状态码: {up_status}"
                    ));
                    return Ok(false);
                }

                let need_total = end - start + 1;
                let mut sent_seg = 0u64;
                while sent_seg < need_total {
                    match resp.chunk().await {
                        Ok(Some(chunk)) => {
                            let take = ((need_total - sent_seg) as usize).min(chunk.len());
                            if take == 0 {
                                break;
                            }
                            if stream.write_all(&chunk[..take]).await.is_err() {
                                return Ok(false);
                            }
                            session.bytes_sent.fetch_add(take as u64, Ordering::Relaxed);
                            sent_seg += take as u64;
                        }
                        Ok(None) => break,
                        Err(e) => {
                            session.record_error(format!("虚拟索引中转读取上游中断: {e}"));
                            return Ok(false);
                        }
                    }
                }
            }
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

    if let Some(ref overlay) = session.virtual_mkv {
        return handle_virtual_mkv_relay(
            stream,
            &session,
            overlay,
            method,
            range_header.as_deref(),
            keep_alive,
        )
        .await;
    }

    let is_head = method.eq_ignore_ascii_case("HEAD");
    let mut resp = match send_with_cached_redirects(
        &session.client,
        &session.upstream_url,
        &session.headers,
        range_header.as_deref(),
        is_head,
        &session.resolved_target,
    )
    .await
    {
        Ok((r, _)) => r,
        Err(e) => {
            session.record_error(e);
            session.record_request(method, 502, range_header.as_deref(), None);
            let err_resp = "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
            let _ = stream.write_all(err_resp.as_bytes()).await;
            return Ok(false);
        }
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
    session.record_request(
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
                session
                    .bytes_sent
                    .fetch_add(chunk.len() as u64, Ordering::Relaxed);
            }
            Ok(None) => break,
            Err(e) => {
                session.record_error(format!("中转传输读取上游中断: {e}"));
                return Ok(false);
            }
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
                mkv_head_summary: None,
                file_truncated: false,
                expected_size: None,
                max_playable_sec: None,
            });
        }
    };

    let mut current_url = origin_url.clone();
    let mut hops: Vec<DiagnosticHopDto> = Vec::new();
    let mut exceeded_redirects = false;
    let mut final_content_length: Option<u64> = None;
    let mut probed_200_head_bytes: Option<Vec<u8>> = None;

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
            if status_code == 200 {
                probed_200_head_bytes = Some(read_limited_bytes(resp, 131_072).await);
            }
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

    let mut total_size = last
        .and_then(|h| h.content_range.as_deref())
        .and_then(|cr| parse_content_range_total(Some(cr)))
        .or(final_content_length);
    let mut mid_range_supported: Option<bool> = None;
    let mut is_mkv = final_ct_lower.contains("matroska");
    let mut has_mkv_cues: Option<bool> = None;
    let mut mkv_head_summary: Option<String> = None;
    let mut file_truncated = false;
    let mut expected_size: Option<u64> = None;
    let mut max_playable_sec: Option<f64> = None;

    if reachable && final_status == Some(206) {
        let is_same = same_origin(&origin_url, &current_url);
        let head_client = client.clone();
        let head_url = current_url.clone();
        let head_headers = header_map.clone();
        let head_fut = async move {
            let req = apply_origin_safe_headers(
                head_client.get(head_url.as_str()),
                &head_headers,
                is_same,
            )
            .header(RANGE, "bytes=0-131071");
            match tokio::time::timeout(Duration::from_secs(6), req.send()).await {
                Ok(Ok(r)) => {
                    let ok = matches!(r.status().as_u16(), 200 | 206);
                    let cr_tot = r
                        .headers()
                        .get(CONTENT_RANGE)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| parse_content_range_total(Some(s)));
                    let bytes = if ok {
                        read_limited_bytes(r, 131_072).await
                    } else {
                        Vec::new()
                    };
                    (bytes, cr_tot)
                }
                _ => (Vec::new(), None),
            }
        };

        let probe_total = total_size.unwrap_or(0);
        let tail_fut = async {
            if probe_total <= 262_144 {
                return Vec::new();
            }
            let tail_start = probe_total - 131_072;
            let rng = format!("bytes={tail_start}-{}", probe_total - 1);
            let req = apply_origin_safe_headers(
                client.get(current_url.as_str()),
                &header_map,
                is_same,
            )
            .header(RANGE, rng);
            match tokio::time::timeout(Duration::from_secs(6), req.send()).await {
                Ok(Ok(r)) if r.status() == reqwest::StatusCode::PARTIAL_CONTENT => {
                    read_limited_bytes(r, 131_072).await
                }
                _ => Vec::new(),
            }
        };

        let mid_fut = async {
            if probe_total <= 262_144 {
                return None;
            }
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
        };

        let ((head_bytes, head_total), tail_bytes, mid_res) =
            tokio::join!(head_fut, tail_fut, mid_fut);
        if total_size.is_none() {
            total_size = head_total;
        }
        mid_range_supported = mid_res;
        if is_ebml_mkv(&head_bytes) {
            is_mkv = true;
        }
        if is_mkv && !head_bytes.is_empty() {
            let head_info = inspect_mkv_head(&head_bytes);
            let tail_cues = find_cues_in_slice(&tail_bytes);
            let tail_cues_count = tail_cues.as_ref().map(|(_, _, _, pts)| pts.len()).unwrap_or(0);

            if let Some(ref info) = head_info {
                let head_usable =
                    cues_cover_duration(&info.cues_in_head_points, info.duration_ticks, false);
                let mut seek_cues_usable = false;
                let mut seek_cues_note = String::from("seekTarget=-");

                if !head_usable {
                    if let (Some(rel_pos), Some(tot)) = (info.seek_head_cues_pos, total_size) {
                        let abs_off = info.seg_data_start.saturating_add(rel_pos);
                        if abs_off < tot {
                            let end_off = (abs_off + 65_535).min(tot - 1);
                            let rng = format!("bytes={abs_off}-{end_off}");
                            let req = apply_origin_safe_headers(
                                client.get(current_url.as_str()),
                                &header_map,
                                is_same,
                            )
                            .header(RANGE, rng);
                            if let Ok(Ok(r)) =
                                tokio::time::timeout(Duration::from_secs(5), req.send()).await
                            {
                                if r.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                                    let buf = read_limited_bytes(r, 65_536).await;
                                    if let Some((_, _, trunc, pts)) = find_cues_in_slice(&buf) {
                                        seek_cues_usable = cues_cover_duration(
                                            &pts,
                                            info.duration_ticks,
                                            trunc,
                                        );
                                        seek_cues_note = format!(
                                            "seekTarget={}({})",
                                            pts.len(),
                                            if seek_cues_usable { "ok" } else { "unusable" }
                                        );
                                    } else {
                                        seek_cues_note = "seekTarget=0(missing)".to_string();
                                    }
                                } else {
                                    seek_cues_note = format!("seekTarget=HTTP{}", r.status().as_u16());
                                }
                            }
                        } else {
                            seek_cues_note = "seekTarget=oob".to_string();
                        }
                    }
                }

                // 检测服务端是否截断上传（原片预期体积 > 实际文件体积）并推算实际可播终点
                expected_size = info.expected_file_size();
                if let (Some(exp), Some(tot)) = (expected_size, total_size) {
                    if exp > tot.saturating_add(4096) {
                        file_truncated = true;
                        let tail_start = tot.saturating_sub(tail_bytes.len() as u64);
                        let mut last_cl = extract_last_cluster_cue_from_window(
                            &tail_bytes,
                            tail_start,
                            info.seg_data_start,
                        );
                        if last_cl.is_none() && tot > 262_144 {
                            let probe_len = (3 * 1024 * 1024u64).min(tot - info.first_cluster_offset);
                            let p_start = tot.saturating_sub(probe_len);
                            let rng = format!("bytes={p_start}-{}", tot - 1);
                            let req = apply_origin_safe_headers(
                                client.get(current_url.as_str()),
                                &header_map,
                                is_same,
                            )
                            .header(RANGE, rng);
                            if let Ok(Ok(r)) =
                                tokio::time::timeout(Duration::from_secs(6), req.send()).await
                            {
                                if r.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                                    let buf = read_limited_bytes(r, probe_len as usize).await;
                                    last_cl = extract_last_cluster_cue_from_window(
                                        &buf,
                                        p_start,
                                        info.seg_data_start,
                                    );
                                }
                            }
                        }
                        if let Some((ts_ticks, _)) = last_cl {
                            let sec = info.ticks_to_seconds(ts_ticks);
                            if sec.is_finite() && sec > 0.0 {
                                max_playable_sec = Some(sec);
                            }
                        } else if let Some(dur_sec) = info.duration_seconds() {
                            if exp > 0 {
                                max_playable_sec = Some(dur_sec * (tot as f64 / exp as f64));
                            }
                        }
                    }
                }

                // 仅头部有效 Cues 或 SeekHead 实测可达的有效 Cues 才视作可用（孤立尾部 Cues 在 MKV 顺序扫流下无法被 demux_mkv 直接定位）
                has_mkv_cues = Some(head_usable || seek_cues_usable);
                mkv_head_summary = Some(format!(
                    "{} · {} · tailCues={}{}",
                    info.summary(),
                    seek_cues_note,
                    tail_cues_count,
                    if file_truncated {
                        format!(
                            " · TRUNCATED(exp={} maxSec={})",
                            expected_size.unwrap_or(0),
                            max_playable_sec
                                .map(|s| format!("{s:.0}s"))
                                .unwrap_or_else(|| "-".to_string())
                        )
                    } else {
                        String::new()
                    }
                ));
            } else {
                has_mkv_cues = Some(false);
                mkv_head_summary = Some(format!(
                    "headParse=none(headLen={}) · tailCues={}",
                    head_bytes.len(),
                    tail_cues_count
                ));
            }
        }
    } else if reachable && final_status == Some(200) {
        mid_range_supported = Some(false);
        if let Some(ref head_bytes) = probed_200_head_bytes {
            if is_ebml_mkv(head_bytes) {
                is_mkv = true;
            }
            if is_mkv {
                let head_info = inspect_mkv_head(head_bytes);
                has_mkv_cues = head_info
                    .as_ref()
                    .map(|i| cues_cover_duration(&i.cues_in_head_points, i.duration_ticks, false));
                mkv_head_summary = head_info.map(|i| i.summary());
            }
        }
    }

    let summary = if reachable && file_truncated {
        let exp_gb = expected_size.unwrap_or(0) as f64 / (1024.0 * 1024.0 * 1024.0);
        let tot_gb = total_size.unwrap_or(0) as f64 / (1024.0 * 1024.0 * 1024.0);
        let playable_hint = max_playable_sec
            .map(|s| {
                let sec = s.floor() as u64;
                format!("约 {:02}:{:02}", sec / 60, sec % 60)
            })
            .unwrap_or_else(|| "前半段".to_string());
        format!(
            "检测到服务端 MKV 文件不完整（预期 {exp_gb:.2} GB，实际仅 {tot_gb:.2} GB，实际可播放至{playable_hint}），超出末尾的续播进度无法加载"
        )
    } else if reachable && mid_range_supported == Some(false) {
        "上游不支持中段 HTTP Range 跳转（返回 HTTP 200），带进度续播需从头顺序读取，建议从 00:00 播放"
            .to_string()
    } else if reachable && is_mkv && has_mkv_cues == Some(false) {
        "Rust 探测支持分段 Range，但该 MKV 缺少可用 Cues 寻址索引（建议使用内置虚拟索引中转加速续播）"
            .to_string()
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
        mkv_head_summary,
        file_truncated,
        expected_size,
        max_playable_sec,
    })
}

struct VirtualOverlayBuildResult {
    overlay: Option<VirtualMkvOverlay>,
    reason: String,
    file_truncated: bool,
    expected_size: Option<u64>,
    max_playable_sec: Option<f64>,
}

/// 流式分块探测首个合法 Cluster：命中后立即 drop 响应中断下载，兼顾 4K 多 MB 大 Cluster 与最小流量开销。
async fn stream_probe_first_cluster(
    mut resp: reqwest::Response,
    start_off: u64,
    seg_data_start: u64,
    max_bytes: usize,
) -> Option<(u64, u64)> {
    let mut buf: Vec<u8> = Vec::with_capacity(256 * 1024);
    let mut scan_from = 0usize;
    while buf.len() < max_bytes {
        match tokio::time::timeout(Duration::from_secs(4), resp.chunk()).await {
            Ok(Ok(Some(chunk))) => {
                let take = (max_bytes - buf.len()).min(chunk.len());
                buf.extend_from_slice(&chunk[..take]);
                if let Some(cue) = extract_cluster_cue_from_window(
                    &buf[scan_from..],
                    start_off.saturating_add(scan_from as u64),
                    seg_data_start,
                ) {
                    return Some(cue);
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

async fn try_build_virtual_mkv_overlay(
    client: &reqwest::Client,
    origin_url_str: &str,
    headers: &HeaderMap,
    initial_time_sec: Option<f64>,
    duration_sec: Option<f64>,
    resolved_cache: &RwLock<Option<ResolvedTargetCache>>,
) -> VirtualOverlayBuildResult {
    let fail = |reason: &str| VirtualOverlayBuildResult {
        overlay: None,
        reason: reason.to_string(),
        file_truncated: false,
        expected_size: None,
        max_playable_sec: None,
    };

    let Ok((head_resp, resolved_url)) = send_with_cached_redirects(
        client,
        origin_url_str,
        headers,
        Some("bytes=0-131071"),
        false,
        resolved_cache,
    )
    .await
    else {
        return fail("head_req_failed");
    };
    if head_resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return fail("head_not_206");
    }
    let Some(total_size) = head_resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| parse_content_range_total(Some(s)))
    else {
        return fail("missing_total_size");
    };
    if total_size <= 512 * 1024 {
        return fail("too_small");
    }
    let mut head_bytes = read_limited_bytes(head_resp, 131_072).await;
    if !is_ebml_mkv(&head_bytes) {
        return fail("not_mkv");
    }

    let mut head_info = inspect_mkv_head(&head_bytes);
    if head_info.is_none() {
        if let Ok((big_resp, _)) = send_with_cached_redirects(
            client,
            origin_url_str,
            headers,
            Some("bytes=0-1048575"),
            false,
            resolved_cache,
        )
        .await
        {
            if big_resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                let bigger = read_limited_bytes(big_resp, 1_048_576).await;
                if !bigger.is_empty() {
                    head_bytes = bigger;
                    head_info = inspect_mkv_head(&head_bytes);
                }
            }
        }
    }
    let Some(head_info) = head_info else {
        return fail("head_parse_failed");
    };

    let expected_size = head_info.expected_file_size();
    let file_truncated = expected_size
        .map(|exp| exp > total_size.saturating_add(4096))
        .unwrap_or(false);
    let mut max_playable_sec: Option<f64> = if file_truncated {
        match (head_info.duration_seconds(), expected_size) {
            (Some(dur), Some(exp)) if exp > 0 => Some(dur * (total_size as f64 / exp as f64)),
            _ => None,
        }
    } else {
        None
    };

    if cues_cover_duration(
        &head_info.cues_in_head_points,
        head_info.duration_ticks,
        false,
    ) {
        return VirtualOverlayBuildResult {
            overlay: None,
            reason: "skipped_valid_head_cues".to_string(),
            file_truncated,
            expected_size,
            max_playable_sec,
        };
    }

    let (Ok(origin_parsed), Ok(target_parsed)) = (Url::parse(origin_url_str), Url::parse(&resolved_url)) else {
        return fail("url_parse_failed");
    };
    let is_same = same_origin(&origin_parsed, &target_parsed);

    if let Some(rel_pos) = head_info.seek_head_cues_pos {
        let abs_off = head_info.seg_data_start.saturating_add(rel_pos);
        if abs_off < total_size {
            let end_off = (abs_off + 65_535).min(total_size - 1);
            let rng = format!("bytes={abs_off}-{end_off}");
            let req = apply_origin_safe_headers(client.get(resolved_url.as_str()), headers, is_same)
                .header(RANGE, rng);
            if let Ok(Ok(r)) = tokio::time::timeout(Duration::from_secs(4), req.send()).await {
                if r.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                    let buf = read_limited_bytes(r, 65_536).await;
                    if let Some((_, _, trunc, pts)) = find_cues_in_slice(&buf) {
                        if cues_cover_duration(&pts, head_info.duration_ticks, trunc) {
                            return VirtualOverlayBuildResult {
                                overlay: None,
                                reason: "skipped_valid_seek_cues".to_string(),
                                file_truncated,
                                expected_size,
                                max_playable_sec,
                            };
                        }
                    }
                }
            }
        }
    }

    // 检查尾部（最多 2 MiB，用于发现孤立 Cues 或截断文件的真实最后 Cluster）与中段 Range 206
    let tail_len = if file_truncated {
        (2 * 1024 * 1024u64).min(total_size.saturating_sub(head_info.first_cluster_offset))
    } else {
        131_072u64.min(total_size)
    };
    let tail_start = total_size.saturating_sub(tail_len);
    let tail_rng = format!("bytes={tail_start}-{}", total_size - 1);
    let mid = total_size / 2;
    let mid_rng = format!("bytes={mid}-{}", mid + 1023);
    let (tail_res, mid_res) = tokio::join!(
        send_with_cached_redirects(
            client,
            origin_url_str,
            headers,
            Some(&tail_rng),
            false,
            resolved_cache,
        ),
        send_with_cached_redirects(
            client,
            origin_url_str,
            headers,
            Some(&mid_rng),
            false,
            resolved_cache,
        )
    );
    let Ok((mid_resp, _)) = mid_res else {
        return VirtualOverlayBuildResult {
            overlay: None,
            reason: "mid_probe_failed".to_string(),
            file_truncated,
            expected_size,
            max_playable_sec,
        };
    };
    if mid_resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return VirtualOverlayBuildResult {
            overlay: None,
            reason: "mid_not_206".to_string(),
            file_truncated,
            expected_size,
            max_playable_sec,
        };
    }
    drop(mid_resp);

    let mut raw_cues: Vec<(u64, u64)> = Vec::new();
    if let Ok((tail_resp, _)) = tail_res {
        if tail_resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            let tail_bytes = read_limited_bytes(tail_resp, tail_len as usize).await;
            if let Some((_, _, trunc, pts)) = find_cues_in_slice(&tail_bytes) {
                if !trunc && cues_cover_duration(&pts, head_info.duration_ticks, false) {
                    if let Some(overlay) =
                        build_virtual_mkv_patch(&head_bytes, &head_info, total_size, &pts)
                    {
                        let cnt = overlay.cue_count;
                        return VirtualOverlayBuildResult {
                            overlay: Some(overlay),
                            reason: format!("lifted_tail_cues({cnt})"),
                            file_truncated,
                            expected_size,
                            max_playable_sec,
                        };
                    }
                }
            }
            if let Some(last_cl) = extract_last_cluster_cue_from_window(
                &tail_bytes,
                tail_start,
                head_info.seg_data_start,
            ) {
                let sec = head_info.ticks_to_seconds(last_cl.0);
                if sec.is_finite() && sec > 0.0 {
                    max_playable_sec = Some(sec);
                }
                raw_cues.push(last_cl);
            }
        }
    }

    if let Some(c0) = extract_cluster_cue_from_window(
        &head_bytes[head_info.first_cluster_offset as usize..],
        head_info.first_cluster_offset,
        head_info.seg_data_start,
    ) {
        raw_cues.push(c0);
    }

    let min_off = head_info.first_cluster_offset.saturating_add(64 * 1024);
    let max_off = total_size.saturating_sub(256 * 1024);
    if max_off <= min_off {
        return VirtualOverlayBuildResult {
            overlay: None,
            reason: "range_too_small".to_string(),
            file_truncated,
            expected_size,
            max_playable_sec,
        };
    }

    // 精简为 6 个均匀分布点 + 最多 2 个目标进度附近点，每点支持最多 4 MiB 流式早停（命中首个 Cluster 即断流）
    let mut probe_offsets: Vec<u64> = (1..=6)
        .map(|i| min_off + ((max_off - min_off) * i) / 7)
        .collect();

    let effective_dur = max_playable_sec
        .or_else(|| head_info.duration_seconds())
        .or(duration_sec);
    if let (Some(init), Some(dur)) = (initial_time_sec, effective_dur) {
        if init > 5.0 && dur > init + 1.0 {
            let est = (((total_size as f64) * (init / dur)).floor() as u64).clamp(min_off, max_off);
            probe_offsets.push(est.saturating_sub(3 * 1024 * 1024).clamp(min_off, max_off));
            probe_offsets.push(est);
        }
    }
    probe_offsets.sort_unstable();
    let mut compact_offsets: Vec<u64> = Vec::with_capacity(probe_offsets.len());
    for off in probe_offsets {
        if compact_offsets
            .last()
            .map(|&prev| off.saturating_sub(prev) >= 512 * 1024)
            .unwrap_or(true)
        {
            compact_offsets.push(off);
        }
    }

    let sem = Arc::new(tokio::sync::Semaphore::new(4));
    let mut handles = Vec::with_capacity(compact_offsets.len());
    let seg_data_start = head_info.seg_data_start;
    for off in compact_offsets {
        let Ok(permit) = sem.clone().acquire_owned().await else {
            break;
        };
        let c = client.clone();
        let u = resolved_url.clone();
        let hdrs = headers.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit;
            let end = (off + 4 * 1024 * 1024 - 1).min(total_size - 1);
            let rng = format!("bytes={off}-{end}");
            let req = apply_origin_safe_headers(c.get(u.as_str()), &hdrs, is_same)
                .header(RANGE, rng);
            let Ok(Ok(resp)) = tokio::time::timeout(Duration::from_secs(6), req.send()).await else {
                return None;
            };
            if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return None;
            }
            stream_probe_first_cluster(resp, off, seg_data_start, 4 * 1024 * 1024).await
        }));
    }

    for h in handles {
        if let Ok(Some(cue)) = h.await {
            raw_cues.push(cue);
        }
    }

    let found_count = raw_cues.len();
    let overlay = build_virtual_mkv_patch(&head_bytes, &head_info, total_size, &raw_cues);
    let reason = match &overlay {
        Some(ov) => format!("ok({}_cues)", ov.cue_count),
        None => format!("too_few_cues({found_count})"),
    };

    VirtualOverlayBuildResult {
        overlay,
        reason,
        file_truncated,
        expected_size,
        max_playable_sec,
    }
}

#[tauri::command]
pub async fn start_stream_relay(request: StartRelayRequest) -> Result<StartedRelayDto, String> {
    let (user_agent, header_map) = parse_request_headers(request.headers);
    let client = build_no_redirect_http_client(request.proxy_url.as_deref(), &user_agent)?;
    let token = Uuid::new_v4().to_string();
    let resolved_target = RwLock::new(None);

    let build_res = if request.enable_mkv_virtual_cues.unwrap_or(false) {
        match tokio::time::timeout(
            Duration::from_secs(15),
            try_build_virtual_mkv_overlay(
                &client,
                &request.url,
                &header_map,
                request.initial_time_sec,
                request.duration_sec,
                &resolved_target,
            ),
        )
        .await
        {
            Ok(res) => res,
            Err(_) => VirtualOverlayBuildResult {
                overlay: None,
                reason: "timeout(15s)".to_string(),
                file_truncated: false,
                expected_size: None,
                max_playable_sec: None,
            },
        }
    } else {
        VirtualOverlayBuildResult {
            overlay: None,
            reason: "disabled".to_string(),
            file_truncated: false,
            expected_size: None,
            max_playable_sec: None,
        }
    };

    let virtual_cues_active = build_res.overlay.is_some();
    let virtual_cues_count = build_res.overlay.as_ref().map(|v| v.cue_count).unwrap_or(0);
    let virtual_cues_reason = Some(build_res.reason);
    let file_truncated = build_res.file_truncated;
    let expected_size = build_res.expected_size;
    let max_playable_sec = build_res.max_playable_sec;

    let session = Arc::new(RelaySession {
        token: token.clone(),
        upstream_url: request.url,
        client,
        headers: header_map,
        resolved_target,
        virtual_mkv: build_res.overlay,
        virtual_cues_reason: virtual_cues_reason.clone(),
        file_truncated,
        expected_size,
        max_playable_sec,
        bytes_sent: AtomicU64::new(0),
        request_count: AtomicU64::new(0),
        last_status: AtomicU16::new(0),
        telemetry: RwLock::new(RelayTelemetry::default()),
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
        virtual_cues_active,
        virtual_cues_count,
        virtual_cues_reason,
        file_truncated,
        expected_size,
        max_playable_sec,
    })
}

#[tauri::command]
pub async fn get_stream_relay_stats(token: String) -> Result<Option<RelayStatsDto>, String> {
    Ok(find_relay_by_token(&token).map(|s| s.to_stats_dto()))
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
}
