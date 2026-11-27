//! Pure EBML / Matroska parser, virtual `Cues` generator, and range mapper for zero-transcode HTTP seeking.

const EBML_MAGIC: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];
const SEGMENT_ID: u32 = 0x1853_8067;
const SEEK_HEAD_ID: u32 = 0x114D_9B74;
const SEEK_ID: u32 = 0x4DBB;
const SEEK_ID_VAL_ID: u32 = 0x53AB;
const SEEK_POS_VAL_ID: u32 = 0x53AC;
const INFO_ID: u32 = 0x1549_A966;
const TIMESTAMP_SCALE_ID: u32 = 0x2AD7_B1;
const DURATION_ID: u32 = 0x4489;
const TRACKS_ID: u32 = 0x1654_AE6B;
const TRACK_ENTRY_ID: u32 = 0xAE;
const TRACK_TYPE_ID: u32 = 0x83;
const TRACK_NUMBER_ID: u32 = 0xD7;
const CUES_ID: u32 = 0x1C53_BB6B;
const CUE_POINT_ID: u32 = 0xBB;
const CUE_TIME_ID: u32 = 0xB3;
const CUE_TRACK_POS_ID: u32 = 0xB7;
const CUE_CLUSTER_POS_ID: u32 = 0xF1;
const CLUSTER_ID: u32 = 0x1F43_B675;
const CLUSTER_TIMESTAMP_ID: u32 = 0xE7;
const VOID_ID: u32 = 0xEC;
const CRC32_ID: u32 = 0xBF;

#[derive(Debug, Clone, PartialEq)]
pub struct MkvHeadInfo {
    pub seg_data_start: u64,
    /// `(vint_offset, vint_width, orig_seg_size)` when Segment has a fixed VINT size; `None` if unknown size.
    pub seg_size_span: Option<(usize, usize, u64)>,
    pub first_cluster_offset: u64,
    pub timestamp_scale_ns: u64,
    pub duration_ticks: Option<f64>,
    pub video_track_number: u64,
    pub has_cues_in_head: bool,
    pub seek_head_mentions_cues: bool,
    pub seek_head_cues_pos: Option<u64>,
    pub seek_head_cues_id_offsets: Vec<usize>,
    pub seek_head_crc_offsets: Vec<usize>,
    pub cues_in_head_span: Option<(usize, usize)>,
    pub cues_in_head_points: Vec<(u64, u64)>,
}

impl MkvHeadInfo {
    pub fn expected_file_size(&self) -> Option<u64> {
        let seg_end = self
            .seg_size_span
            .map(|(_, _, sz)| self.seg_data_start.saturating_add(sz));
        let cues_end = self
            .seek_head_cues_pos
            .map(|pos| self.seg_data_start.saturating_add(pos));
        match (seg_end, cues_end) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        }
    }

    pub fn ticks_to_seconds(&self, ticks: u64) -> f64 {
        (ticks as f64) * (self.timestamp_scale_ns as f64) / 1_000_000_000.0
    }

    pub fn duration_seconds(&self) -> Option<f64> {
        let d = self.duration_ticks?;
        if d.is_finite() && d > 0.0 {
            Some(d * (self.timestamp_scale_ns as f64) / 1_000_000_000.0)
        } else {
            None
        }
    }

    pub fn summary(&self) -> String {
        format!(
            "segStart={} firstCl={} durTicks={} seekCues={} headCues={}({})",
            self.seg_data_start,
            self.first_cluster_offset,
            self.duration_ticks
                .map(|d| format!("{d:.0}"))
                .unwrap_or_else(|| "-".to_string()),
            self.seek_head_cues_pos
                .map(|p| p.to_string())
                .unwrap_or_else(|| "-".to_string()),
            self.has_cues_in_head,
            self.cues_in_head_points.len()
        )
    }
}

#[derive(Debug, Clone)]
pub struct VirtualMkvOverlay {
    pub prefix_bytes: Vec<u8>,
    pub original_body_start: u64,
    pub original_total_size: u64,
    pub virtual_total_size: u64,
    pub cue_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VirtualRangeSegment {
    MemorySlice { start: usize, end: usize },
    UpstreamRange { start: u64, end: u64 },
}

pub fn is_ebml_mkv(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[..4] == EBML_MAGIC
}

fn read_vint_raw(buf: &[u8], pos: usize, keep_marker: bool) -> Option<(u64, usize, usize)> {
    let first = *buf.get(pos)?;
    if first == 0 {
        return None;
    }
    let width = first.leading_zeros() as usize + 1;
    if width == 0 || width > 8 || pos + width > buf.len() {
        return None;
    }
    let mask = if keep_marker {
        0xFFu8
    } else {
        (1u8 << (8 - width)).wrapping_sub(1)
    };
    let mut val = (first & mask) as u64;
    for i in 1..width {
        val = (val << 8) | (buf[pos + i] as u64);
    }
    Some((val, width, pos + width))
}

fn read_vint_id(buf: &[u8], pos: usize) -> Option<(u32, usize, usize)> {
    let (val, width, next) = read_vint_raw(buf, pos, true)?;
    if width > 4 {
        return None;
    }
    Some((val as u32, width, next))
}

fn read_vint_size(buf: &[u8], pos: usize) -> Option<(Option<u64>, usize, usize)> {
    let (val, width, next) = read_vint_raw(buf, pos, false)?;
    let max_val = if width == 8 {
        (1u64 << 56) - 1
    } else {
        (1u64 << (7 * width)) - 1
    };
    if val == max_val {
        Some((None, width, next))
    } else {
        Some((Some(val), width, next))
    }
}

fn read_uint_be(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() || bytes.len() > 8 {
        return None;
    }
    let mut val = 0u64;
    for &b in bytes {
        val = (val << 8) | (b as u64);
    }
    Some(val)
}

fn read_float_be(bytes: &[u8]) -> Option<f64> {
    match bytes.len() {
        4 => Some(f32::from_be_bytes(bytes.try_into().ok()?) as f64),
        8 => Some(f64::from_be_bytes(bytes.try_into().ok()?)),
        _ => None,
    }
}

fn encode_vint_size(val: u64) -> Option<Vec<u8>> {
    for width in 1..=8 {
        let max_val = if width == 8 {
            (1u64 << 56) - 2
        } else {
            (1u64 << (7 * width)) - 2
        };
        if val <= max_val {
            let mut out = vec![0u8; width];
            let mut tmp = val;
            for i in (0..width).rev() {
                out[i] = (tmp & 0xFF) as u8;
                tmp >>= 8;
            }
            out[0] |= 1u8 << (8 - width);
            return Some(out);
        }
    }
    None
}

fn encode_fixed_width_vint_size(val: Option<u64>, width: usize) -> Option<Vec<u8>> {
    if width == 0 || width > 8 {
        return None;
    }
    let all_ones = if width == 8 {
        (1u64 << 56) - 1
    } else {
        (1u64 << (7 * width)) - 1
    };
    let raw_val = match val {
        Some(v) if v < all_ones => v,
        _ => all_ones,
    };
    let mut out = vec![0u8; width];
    let mut tmp = raw_val;
    for i in (0..width).rev() {
        out[i] = (tmp & 0xFF) as u8;
        tmp >>= 8;
    }
    out[0] |= 1u8 << (8 - width);
    Some(out)
}

fn encode_uint_minimal(val: u64) -> Vec<u8> {
    if val == 0 {
        return vec![0];
    }
    let bytes = val.to_be_bytes();
    let first_nonzero = bytes.iter().position(|&b| b != 0).unwrap_or(7);
    bytes[first_nonzero..].to_vec()
}

fn ebml_elem(id_bytes: &[u8], payload: &[u8]) -> Vec<u8> {
    let len_vint = encode_vint_size(payload.len() as u64).unwrap_or_else(|| vec![0xFF]);
    let mut out = Vec::with_capacity(id_bytes.len() + len_vint.len() + payload.len());
    out.extend_from_slice(id_bytes);
    out.extend_from_slice(&len_vint);
    out.extend_from_slice(payload);
    out
}

/// 解析 `Cues` 元素体内的全部 `(CueTime, CueClusterPosition)` 索引点（跳过可选 `0xBF` CRC-32 与 `0xEC` Void）。
pub fn parse_cues_points(body: &[u8]) -> Vec<(u64, u64)> {
    let mut points = Vec::new();
    let mut pos = 0usize;
    while pos < body.len() {
        let Some((id, _, p1)) = read_vint_id(body, pos) else {
            break;
        };
        let Some((Some(sz), _, p2)) = read_vint_size(body, p1) else {
            break;
        };
        if sz > 1024 * 1024 {
            break;
        }
        let end = p2.saturating_add(sz as usize);
        if end > body.len() {
            break;
        }
        if id == CUE_POINT_ID {
            let mut cue_time: Option<u64> = None;
            let mut cue_cluster_pos: Option<u64> = None;
            let mut cp = p2;
            while cp < end {
                let Some((cid, _, c1)) = read_vint_id(body, cp) else {
                    break;
                };
                let Some((Some(csz), _, c2)) = read_vint_size(body, c1) else {
                    break;
                };
                let cend = c2.saturating_add(csz as usize);
                if cend > end {
                    break;
                }
                if cid == CUE_TIME_ID {
                    cue_time = read_uint_be(&body[c2..cend]);
                } else if cid == CUE_TRACK_POS_ID && cue_cluster_pos.is_none() {
                    let mut tp = c2;
                    while tp < cend {
                        let Some((tid, _, t1)) = read_vint_id(body, tp) else {
                            break;
                        };
                        let Some((Some(tsz), _, t2)) = read_vint_size(body, t1) else {
                            break;
                        };
                        let tend = t2.saturating_add(tsz as usize);
                        if tend > cend {
                            break;
                        }
                        if tid == CUE_CLUSTER_POS_ID {
                            cue_cluster_pos = read_uint_be(&body[t2..tend]);
                            break;
                        }
                        tp = tend;
                    }
                }
                cp = cend;
            }
            if let (Some(ts), Some(cpos)) = (cue_time, cue_cluster_pos) {
                points.push((ts, cpos));
            }
        } else if id != CRC32_ID && id != VOID_ID {
            break;
        }
        pos = end;
    }
    points
}

/// 在任意字节窗中查找真实 `Cues` 元素，返回 `(elem_start, elem_end, is_truncated, parsed_points)`。
pub fn find_cues_in_slice(bytes: &[u8]) -> Option<(usize, usize, bool, Vec<(u64, u64)>)> {
    let needle = [0x1Cu8, 0x53, 0xBB, 0x6B];
    let mut start = 0usize;
    while let Some(rel) = bytes[start..].windows(4).position(|w| w == needle) {
        let abs = start + rel;
        if let Some((size_opt, _, body_start)) = read_vint_size(bytes, abs + 4) {
            let Some(first_child_id) = read_vint_id(bytes, body_start).map(|(id, _, _)| id) else {
                start = abs + 1;
                continue;
            };
            if matches!(first_child_id, CUE_POINT_ID | CRC32_ID | VOID_ID) {
                let (elem_end, truncated) = match size_opt {
                    Some(sz) => {
                        let raw_end = body_start.saturating_add(sz as usize);
                        (raw_end.min(bytes.len()), raw_end > bytes.len())
                    }
                    None => (bytes.len(), false),
                };
                let pts = parse_cues_points(&bytes[body_start..elem_end]);
                if !pts.is_empty() {
                    return Some((abs, elem_end, truncated, pts));
                }
            }
        }
        start = abs + 1;
    }
    None
}

/// 检查局部字节窗口是否包含真实且至少有 1 个索引点的 `Cues` 元素（兼容前导 `0xBF` CRC-32）。
#[cfg(test)]
pub fn has_cues_magic(bytes: &[u8]) -> bool {
    find_cues_in_slice(bytes).is_some()
}

/// 校验证明 `Cues` 是否真正可用（至少包含多关键点，且若已知总时长则最大时间戳须覆盖至少一半时长）。
pub fn cues_cover_duration(cues: &[(u64, u64)], duration_ticks: Option<f64>, truncated: bool) -> bool {
    if truncated && cues.len() >= 5 {
        return true;
    }
    if cues.len() < 3 {
        return false;
    }
    if let Some(dur) = duration_ticks {
        if dur.is_finite() && dur > 10.0 {
            let max_ts = cues.iter().map(|&(ts, _)| ts).max().unwrap_or(0) as f64;
            return max_ts >= dur * 0.5;
        }
    }
    true
}

struct SeekHeadParseResult {
    mentions_cues: bool,
    cues_pos: Option<u64>,
    cues_id_offsets: Vec<usize>,
    crc_offsets: Vec<usize>,
}

fn parse_seek_head(buf: &[u8], base_offset: usize) -> SeekHeadParseResult {
    let mut out = SeekHeadParseResult {
        mentions_cues: false,
        cues_pos: None,
        cues_id_offsets: Vec::new(),
        crc_offsets: Vec::new(),
    };
    let mut pos = 0usize;
    while pos < buf.len() {
        let Some((id, _, p1)) = read_vint_id(buf, pos) else {
            break;
        };
        let Some((Some(sz), _, p2)) = read_vint_size(buf, p1) else {
            break;
        };
        let end = p2.saturating_add(sz as usize).min(buf.len());
        if id == CRC32_ID {
            out.crc_offsets.push(base_offset + pos);
        } else if id == SEEK_ID {
            let mut entry_cues_id_off: Option<usize> = None;
            let mut entry_pos: Option<u64> = None;
            let mut inner = p2;
            while inner < end {
                let Some((cid, _, c1)) = read_vint_id(buf, inner) else {
                    break;
                };
                let Some((Some(csz), _, c2)) = read_vint_size(buf, c1) else {
                    break;
                };
                let cend = c2.saturating_add(csz as usize).min(end);
                if cid == SEEK_ID_VAL_ID
                    && cend - c2 == 4
                    && buf[c2..cend] == [0x1C, 0x53, 0xBB, 0x6B]
                {
                    out.mentions_cues = true;
                    entry_cues_id_off = Some(base_offset + c2);
                    out.cues_id_offsets.push(base_offset + c2);
                } else if cid == SEEK_POS_VAL_ID {
                    entry_pos = read_uint_be(&buf[c2..cend]);
                }
                inner = cend;
            }
            if entry_cues_id_off.is_some() && out.cues_pos.is_none() {
                out.cues_pos = entry_pos;
            }
        }
        pos = end;
    }
    out
}

fn parse_info_element(buf: &[u8]) -> (u64, Option<f64>) {
    let mut ts_scale = 1_000_000u64;
    let mut dur = None;
    let mut pos = 0usize;
    while pos < buf.len() {
        let Some((id, _, p1)) = read_vint_id(buf, pos) else {
            break;
        };
        let Some((Some(sz), _, p2)) = read_vint_size(buf, p1) else {
            break;
        };
        let end = p2.saturating_add(sz as usize).min(buf.len());
        if id == TIMESTAMP_SCALE_ID {
            if let Some(v) = read_uint_be(&buf[p2..end]) {
                if v > 0 {
                    ts_scale = v;
                }
            }
        } else if id == DURATION_ID {
            dur = read_float_be(&buf[p2..end]);
        }
        pos = end;
    }
    (ts_scale, dur)
}

fn parse_tracks_video_number(buf: &[u8]) -> Option<u64> {
    let mut pos = 0usize;
    while pos < buf.len() {
        let Some((id, _, p1)) = read_vint_id(buf, pos) else {
            break;
        };
        let Some((Some(sz), _, p2)) = read_vint_size(buf, p1) else {
            break;
        };
        let end = p2.saturating_add(sz as usize).min(buf.len());
        if id == TRACK_ENTRY_ID {
            let mut track_type = None;
            let mut track_number = None;
            let mut inner = p2;
            while inner < end {
                let Some((cid, _, c1)) = read_vint_id(buf, inner) else {
                    break;
                };
                let Some((Some(csz), _, c2)) = read_vint_size(buf, c1) else {
                    break;
                };
                let cend = c2.saturating_add(csz as usize).min(end);
                if cid == TRACK_TYPE_ID {
                    track_type = read_uint_be(&buf[c2..cend]);
                } else if cid == TRACK_NUMBER_ID {
                    track_number = read_uint_be(&buf[c2..cend]);
                }
                inner = cend;
            }
            if track_type == Some(1) {
                if let Some(num) = track_number {
                    return Some(num);
                }
            }
        }
        pos = end;
    }
    None
}

/// 解析 MKV 头部字节并定位首个 `Cluster` 偏移及关键元数据。
pub fn inspect_mkv_head(head: &[u8]) -> Option<MkvHeadInfo> {
    if !is_ebml_mkv(head) {
        return None;
    }

    let (ebml_id, _, p1) = read_vint_id(head, 0)?;
    if ebml_id != 0x1A45_DFA3 {
        return None;
    }
    let (Some(ebml_size), _, ebml_body_start) = read_vint_size(head, p1)? else {
        return None;
    };
    let mut pos = ebml_body_start.checked_add(ebml_size as usize)?;
    while pos < head.len() {
        let (root_id, _, rp1) = read_vint_id(head, pos)?;
        if root_id == VOID_ID {
            let (Some(vsz), _, rp2) = read_vint_size(head, rp1)? else {
                return None;
            };
            pos = rp2.checked_add(vsz as usize)?;
            continue;
        }
        break;
    }
    if pos >= head.len() {
        return None;
    }

    let (seg_id, _, s1) = read_vint_id(head, pos)?;
    if seg_id != SEGMENT_ID {
        return None;
    }
    let seg_size_offset = s1;
    let (seg_size_opt, seg_size_width, seg_data_start) = read_vint_size(head, s1)?;
    let seg_size_span = seg_size_opt.map(|sz| (seg_size_offset, seg_size_width, sz));

    let mut info = MkvHeadInfo {
        seg_data_start: seg_data_start as u64,
        seg_size_span,
        first_cluster_offset: 0,
        timestamp_scale_ns: 1_000_000,
        duration_ticks: None,
        video_track_number: 1,
        has_cues_in_head: false,
        seek_head_mentions_cues: false,
        seek_head_cues_pos: None,
        seek_head_cues_id_offsets: Vec::new(),
        seek_head_crc_offsets: Vec::new(),
        cues_in_head_span: None,
        cues_in_head_points: Vec::new(),
    };

    pos = seg_data_start;
    while pos < head.len() {
        let Some((id, _, e1)) = read_vint_id(head, pos) else {
            break;
        };
        if id == CLUSTER_ID {
            info.first_cluster_offset = pos as u64;
            return Some(info);
        }
        let Some((sz_opt, _, body_start)) = read_vint_size(head, e1) else {
            break;
        };
        let Some(sz) = sz_opt else {
            break;
        };
        let end = body_start.saturating_add(sz as usize);
        if end > head.len() {
            break;
        }
        let payload = &head[body_start..end];
        match id {
            CUES_ID => {
                info.has_cues_in_head = true;
                info.cues_in_head_span = Some((pos, end));
                info.cues_in_head_points = parse_cues_points(payload);
            }
            SEEK_HEAD_ID => {
                let sh = parse_seek_head(payload, body_start);
                if sh.mentions_cues {
                    info.seek_head_mentions_cues = true;
                }
                if info.seek_head_cues_pos.is_none() {
                    info.seek_head_cues_pos = sh.cues_pos;
                }
                info.seek_head_cues_id_offsets.extend(sh.cues_id_offsets);
                info.seek_head_crc_offsets.extend(sh.crc_offsets);
            }
            INFO_ID => {
                let (scale, dur) = parse_info_element(payload);
                info.timestamp_scale_ns = scale;
                info.duration_ticks = dur;
            }
            TRACKS_ID => {
                if let Some(num) = parse_tracks_video_number(payload) {
                    info.video_track_number = num;
                }
            }
            _ => {}
        }
        pos = end;
    }

    None
}

/// 在分段下载窗口中扫描首个合法 `Cluster` 及其 `Timestamp`，返回 `(timestamp_ticks, cluster_rel_pos)`。
pub fn extract_cluster_cue_from_window(
    window: &[u8],
    window_abs_offset: u64,
    seg_data_start: u64,
) -> Option<(u64, u64)> {
    let needle = [0x1Fu8, 0x43, 0xB6, 0x75];
    let mut search_from = 0usize;

    while let Some(rel_idx) = window[search_from..].windows(4).position(|w| w == needle) {
        let abs_in_win = search_from + rel_idx;
        let cluster_abs = window_abs_offset.checked_add(abs_in_win as u64)?;
        if cluster_abs < seg_data_start {
            search_from = abs_in_win + 1;
            continue;
        }

        if let Some((_cluster_sz_opt, _, mut p)) = read_vint_size(window, abs_in_win + 4) {
            for _ in 0..4 {
                let Some((cid, _, c1)) = read_vint_id(window, p) else {
                    break;
                };
                let Some((Some(csz), _, c2)) = read_vint_size(window, c1) else {
                    break;
                };
                if csz > 16 * 1024 * 1024 {
                    break;
                }
                let next_p = c2.saturating_add(csz as usize);
                if cid == CLUSTER_TIMESTAMP_ID && (1..=8).contains(&csz) && next_p <= window.len() {
                    if let Some(ts) = read_uint_be(&window[c2..next_p]) {
                        let plausible_next = match read_vint_id(window, next_p) {
                            Some((next_id, _, _)) => matches!(
                                next_id,
                                0xA3 | 0xA0 | 0xA7 | 0xAB | 0x5854 | 0xEC | 0xAF | 0xE7
                            ),
                            None => next_p == window.len(),
                        };
                        if plausible_next {
                            return Some((ts, cluster_abs - seg_data_start));
                        }
                    }
                }
                if next_p >= window.len() {
                    break;
                }
                p = next_p;
            }
        }
        search_from = abs_in_win + 1;
    }

    None
}

/// 在窗口中扫描最后一个合法 `Cluster` 及其 `Timestamp`，用于测定截断 MKV 的真实可播终点。
pub fn extract_last_cluster_cue_from_window(
    window: &[u8],
    window_abs_offset: u64,
    seg_data_start: u64,
) -> Option<(u64, u64)> {
    let needle = [0x1Fu8, 0x43, 0xB6, 0x75];
    let mut search_from = 0usize;
    let mut last_found: Option<(u64, u64)> = None;

    while let Some(rel_idx) = window[search_from..].windows(4).position(|w| w == needle) {
        let abs_in_win = search_from + rel_idx;
        let Some(cluster_abs) = window_abs_offset.checked_add(abs_in_win as u64) else {
            break;
        };
        if cluster_abs >= seg_data_start {
            if let Some((_cluster_sz_opt, _, mut p)) = read_vint_size(window, abs_in_win + 4) {
                for _ in 0..4 {
                    let Some((cid, _, c1)) = read_vint_id(window, p) else {
                        break;
                    };
                    let Some((Some(csz), _, c2)) = read_vint_size(window, c1) else {
                        break;
                    };
                    if csz > 16 * 1024 * 1024 {
                        break;
                    }
                    let next_p = c2.saturating_add(csz as usize);
                    if cid == CLUSTER_TIMESTAMP_ID
                        && (1..=8).contains(&csz)
                        && next_p <= window.len()
                    {
                        if let Some(ts) = read_uint_be(&window[c2..next_p]) {
                            let plausible_next = match read_vint_id(window, next_p) {
                                Some((next_id, _, _)) => matches!(
                                    next_id,
                                    0xA3 | 0xA0 | 0xA7 | 0xAB | 0x5854 | 0xEC | 0xAF | 0xE7
                                ),
                                None => next_p == window.len(),
                            };
                            if plausible_next {
                                last_found = Some((ts, cluster_abs - seg_data_start));
                                break;
                            }
                        }
                    }
                    if next_p >= window.len() {
                        break;
                    }
                    p = next_p;
                }
            }
        }
        search_from = abs_in_win + 4;
    }

    last_found
}

/// 将指定区间 `[start..end]` 原地替换为等字节长度的 EBML `Void` (`0xEC`) 元素，保持前后字节偏移绝对不变。
fn overwrite_with_void(buf: &mut [u8], start: usize, end: usize) {
    let total = end.saturating_sub(start);
    if total < 2 || end > buf.len() {
        return;
    }
    buf[start..end].fill(0);
    buf[start] = 0xEC;
    // 为保证 payload 长度编码严格匹配剩余字节数，先尝试 1..=8 字节 VINT 宽度
    for width in 1..=8 {
        if 1 + width > total {
            break;
        }
        let payload_len = (total - 1 - width) as u64;
        let max_val = if width == 8 {
            (1u64 << 56) - 2
        } else {
            (1u64 << (7 * width)) - 2
        };
        if payload_len <= max_val {
            if let Some(vint) = encode_fixed_width_vint_size(Some(payload_len), width) {
                buf[start + 1..start + 1 + width].copy_from_slice(&vint);
                return;
            }
        }
    }
}

/// 生成插入在首个 `Cluster` 之前的虚拟 `Cues` 头部补丁（并自动清理残缺 `SeekHead -> Cues` / 头部残缺 `Cues`）。
pub fn build_virtual_mkv_patch(
    head_buf: &[u8],
    info: &MkvHeadInfo,
    orig_total_size: u64,
    raw_cues: &[(u64, u64)],
) -> Option<VirtualMkvOverlay> {
    let first_cluster = info.first_cluster_offset as usize;
    if first_cluster == 0 || first_cluster > head_buf.len() || orig_total_size <= info.first_cluster_offset {
        return None;
    }

    let mut sorted: Vec<(u64, u64)> = raw_cues.to_vec();
    sorted.sort_by_key(|&(_, rel_pos)| rel_pos);

    let min_rel = info.first_cluster_offset - info.seg_data_start;
    let mut deduped: Vec<(u64, u64)> = Vec::with_capacity(sorted.len());
    for (ts, rel_pos) in sorted {
        if rel_pos < min_rel {
            continue;
        }
        if let Some(&(last_ts, last_pos)) = deduped.last() {
            if ts <= last_ts || rel_pos <= last_pos {
                continue;
            }
        }
        deduped.push((ts, rel_pos));
    }

    if deduped.len() < 2 {
        return None;
    }

    let track_bytes = encode_uint_minimal(info.video_track_number.max(1));
    let mut shift = 0u64;
    let mut cues_elem = Vec::new();
    for _ in 0..4 {
        let mut points_buf = Vec::new();
        for &(ts, rel_pos) in &deduped {
            let cue_track = ebml_elem(&[0xF7], &track_bytes);
            let cue_pos = ebml_elem(&[0xF1], &encode_uint_minimal(rel_pos + shift));
            let mut ctp_payload = Vec::with_capacity(cue_track.len() + cue_pos.len());
            ctp_payload.extend_from_slice(&cue_track);
            ctp_payload.extend_from_slice(&cue_pos);
            let ctp = ebml_elem(&[0xB7], &ctp_payload);

            let cue_time = ebml_elem(&[0xB3], &encode_uint_minimal(ts));
            let mut cp_payload = Vec::with_capacity(cue_time.len() + ctp.len());
            cp_payload.extend_from_slice(&cue_time);
            cp_payload.extend_from_slice(&ctp);
            points_buf.extend_from_slice(&ebml_elem(&[0xBB], &cp_payload));
        }
        cues_elem = ebml_elem(&[0x1C, 0x53, 0xBB, 0x6B], &points_buf);
        let next_shift = cues_elem.len() as u64;
        if next_shift == shift {
            break;
        }
        shift = next_shift;
    }

    if shift == 0 || cues_elem.is_empty() {
        return None;
    }

    let mut prefix_bytes = Vec::with_capacity(first_cluster + cues_elem.len());
    prefix_bytes.extend_from_slice(&head_buf[..first_cluster]);

    // 1. 若旧 SeekHead 指向失效/外部 Cues，中和其 SeekID（避免 demux_mkv 延迟跳转到错误 EOF 偏移），并失效旧 CRC-32
    for &id_off in &info.seek_head_cues_id_offsets {
        if id_off + 4 <= prefix_bytes.len() && prefix_bytes[id_off..id_off + 4] == [0x1C, 0x53, 0xBB, 0x6B] {
            prefix_bytes[id_off..id_off + 4].copy_from_slice(&[0x12, 0x54, 0xC3, 0x68]);
        }
    }
    for &crc_off in &info.seek_head_crc_offsets {
        if crc_off < prefix_bytes.len() && prefix_bytes[crc_off] == 0xBF {
            prefix_bytes[crc_off] = 0xEC;
        }
    }

    // 2. 若头部原有残缺 Cues，将其等长覆盖为 Void (0xEC) 避免污染新索引
    if let Some((c_start, c_end)) = info.cues_in_head_span {
        if c_end <= prefix_bytes.len() {
            overwrite_with_void(&mut prefix_bytes, c_start, c_end);
        }
    }

    // 3. 原地更新定长 Segment 尺寸，钳制为真实可用大小 + shift，保持 VINT 字节宽度不变以防偏移错位
    if let Some((size_off, width, _orig_seg_sz)) = info.seg_size_span {
        if size_off + width <= prefix_bytes.len() {
            let actual_seg_sz = orig_total_size.saturating_sub(info.seg_data_start);
            let new_seg_sz = actual_seg_sz.saturating_add(shift);
            if let Some(encoded) = encode_fixed_width_vint_size(Some(new_seg_sz), width) {
                prefix_bytes[size_off..size_off + width].copy_from_slice(&encoded);
            }
        }
    }

    prefix_bytes.extend_from_slice(&cues_elem);

    Some(VirtualMkvOverlay {
        prefix_bytes,
        original_body_start: info.first_cluster_offset,
        original_total_size: orig_total_size,
        virtual_total_size: orig_total_size.saturating_add(shift),
        cue_count: deduped.len(),
    })
}

/// 将虚拟字节范围 `[req_start, req_end]` 映射为「内存前缀切片」与「上游原始区间」。
pub fn map_virtual_range(
    overlay: &VirtualMkvOverlay,
    req_start: u64,
    req_end: u64,
) -> Vec<VirtualRangeSegment> {
    if req_end < req_start || overlay.virtual_total_size == 0 {
        return Vec::new();
    }
    let clamped_end = req_end.min(overlay.virtual_total_size - 1);
    let prefix_len = overlay.prefix_bytes.len() as u64;
    let mut segments = Vec::with_capacity(2);

    if req_start < prefix_len {
        let mem_end = (clamped_end + 1).min(prefix_len) as usize;
        segments.push(VirtualRangeSegment::MemorySlice {
            start: req_start as usize,
            end: mem_end,
        });
    }

    if clamped_end >= prefix_len {
        let v_start = req_start.max(prefix_len);
        let shift = prefix_len.saturating_sub(overlay.original_body_start);
        let up_start = v_start.saturating_sub(shift);
        let up_end = clamped_end.saturating_sub(shift).min(overlay.original_total_size - 1);
        if up_end >= up_start {
            segments.push(VirtualRangeSegment::UpstreamRange {
                start: up_start,
                end: up_end,
            });
        }
    }

    segments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_synthetic_mkv(with_cues_in_head: bool, unknown_seg_size: bool) -> Vec<u8> {
        let ebml_body = ebml_elem(&[0x42, 0x82], b"matroska");
        let ebml_hdr = ebml_elem(&[0x1A, 0x45, 0xDF, 0xA3], &ebml_body);

        let ts_scale = ebml_elem(&[0x2A, 0xD7, 0xB1], &encode_uint_minimal(1_000_000));
        let dur = ebml_elem(&[0x44, 0x89], &60000.0f64.to_be_bytes());
        let info_elem = ebml_elem(&[0x15, 0x49, 0xA9, 0x66], &[ts_scale, dur].concat());

        let tn = ebml_elem(&[0xD7], &[2]);
        let tt = ebml_elem(&[0x83], &[1]);
        let te = ebml_elem(&[0xAE], &[tn, tt].concat());
        let tracks_elem = ebml_elem(&[0x16, 0x54, 0xAE, 0x6B], &te);

        let cues_elem = if with_cues_in_head {
            let ctp = ebml_elem(
                &[0xB7],
                &[ebml_elem(&[0xF7], &[2]), ebml_elem(&[0xF1], &[120])].concat(),
            );
            let cp = ebml_elem(&[0xBB], &[ebml_elem(&[0xB3], &[0]), ctp].concat());
            let crc = ebml_elem(&[0xBF], &[1, 2, 3, 4]);
            ebml_elem(&[0x1C, 0x53, 0xBB, 0x6B], &[crc, cp].concat())
        } else {
            Vec::new()
        };

        let block = ebml_elem(&[0xA3], &[0x82, 0x00, 0x00, 0x80, 0xAA, 0xBB]);
        let cl0 = ebml_elem(
            &[0x1F, 0x43, 0xB6, 0x75],
            &[ebml_elem(&[0xE7], &encode_uint_minimal(0)), block.clone()].concat(),
        );
        let cl1 = ebml_elem(
            &[0x1F, 0x43, 0xB6, 0x75],
            &[ebml_elem(&[0xE7], &encode_uint_minimal(5000)), block].concat(),
        );

        let seg_payload = [info_elem, tracks_elem, cues_elem, cl0, cl1].concat();
        let seg_size_bytes = if unknown_seg_size {
            vec![0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]
        } else {
            encode_fixed_width_vint_size(Some(seg_payload.len() as u64), 4).unwrap()
        };

        let mut file = Vec::new();
        file.extend_from_slice(&ebml_hdr);
        file.extend_from_slice(&[0x18, 0x53, 0x80, 0x67]);
        file.extend_from_slice(&seg_size_bytes);
        file.extend_from_slice(&seg_payload);
        file
    }

    #[test]
    fn test_inspect_mkv_head_and_cluster_extraction() {
        let mkv = make_synthetic_mkv(false, false);
        assert!(is_ebml_mkv(&mkv));
        assert!(!has_cues_magic(&mkv));

        let head_info = inspect_mkv_head(&mkv).expect("head should parse");
        assert!(!head_info.has_cues_in_head);
        assert_eq!(head_info.video_track_number, 2);
        assert_eq!(head_info.timestamp_scale_ns, 1_000_000);
        assert_eq!(head_info.duration_ticks, Some(60000.0));
        assert!(head_info.seg_size_span.is_some());
        assert!(head_info.first_cluster_offset > head_info.seg_data_start);

        let cue0 = extract_cluster_cue_from_window(
            &mkv[head_info.first_cluster_offset as usize..],
            head_info.first_cluster_offset,
            head_info.seg_data_start,
        )
        .expect("cluster 0 should extract");
        assert_eq!(cue0.0, 0);

        let after_c0 = head_info.first_cluster_offset as usize + 10;
        let cue1 = extract_cluster_cue_from_window(
            &mkv[after_c0..],
            after_c0 as u64,
            head_info.seg_data_start,
        )
        .expect("cluster 1 should extract");
        assert_eq!(cue1.0, 5000);
        assert!(cue1.1 > cue0.1);
    }

    #[test]
    fn test_build_virtual_mkv_patch_and_map_range() {
        let mkv = make_synthetic_mkv(false, false);
        let head_info = inspect_mkv_head(&mkv).unwrap();
        let cue0 = extract_cluster_cue_from_window(
            &mkv[head_info.first_cluster_offset as usize..],
            head_info.first_cluster_offset,
            head_info.seg_data_start,
        )
        .unwrap();
        let after_c0 = head_info.first_cluster_offset as usize + 10;
        let cue1 = extract_cluster_cue_from_window(
            &mkv[after_c0..],
            after_c0 as u64,
            head_info.seg_data_start,
        )
        .unwrap();

        let overlay =
            build_virtual_mkv_patch(&mkv, &head_info, mkv.len() as u64, &[cue0, cue1])
                .expect("overlay should build");
        assert_eq!(overlay.cue_count, 2);
        assert!(has_cues_magic(&overlay.prefix_bytes));

        let virtual_full = [
            overlay.prefix_bytes.as_slice(),
            &mkv[overlay.original_body_start as usize..],
        ]
        .concat();
        assert_eq!(virtual_full.len() as u64, overlay.virtual_total_size);
        let patched_info = inspect_mkv_head(&virtual_full).expect("patched mkv must remain valid");
        assert!(patched_info.has_cues_in_head);
        assert_eq!(patched_info.cues_in_head_points.len(), 2);
        let (_, _, new_seg_sz) = patched_info.seg_size_span.unwrap();
        assert_eq!(
            patched_info.seg_data_start + new_seg_sz,
            virtual_full.len() as u64
        );

        let segs = map_virtual_range(&overlay, 10, overlay.virtual_total_size - 1);
        assert_eq!(segs.len(), 2);
        assert_eq!(
            segs[0],
            VirtualRangeSegment::MemorySlice {
                start: 10,
                end: overlay.prefix_bytes.len()
            }
        );
        assert_eq!(
            segs[1],
            VirtualRangeSegment::UpstreamRange {
                start: overlay.original_body_start,
                end: (mkv.len() - 1) as u64
            }
        );
    }

    #[test]
    fn test_head_with_crc_cues_and_broken_cues_replacement() {
        let mkv = make_synthetic_mkv(true, false);
        let head_info = inspect_mkv_head(&mkv).unwrap();
        assert!(head_info.has_cues_in_head);
        assert_eq!(head_info.cues_in_head_points.len(), 1);
        assert!(!cues_cover_duration(
            &head_info.cues_in_head_points,
            head_info.duration_ticks,
            false
        ));
        assert!(has_cues_magic(&mkv));

        // 1-point broken Cues should be neutralized to Void and replaced by new multi-point Cues
        let overlay = build_virtual_mkv_patch(
            &mkv,
            &head_info,
            mkv.len() as u64,
            &[(0, head_info.first_cluster_offset - head_info.seg_data_start), (5000, head_info.first_cluster_offset - head_info.seg_data_start + 20)],
        )
        .unwrap();
        let virtual_full = [
            overlay.prefix_bytes.as_slice(),
            &mkv[overlay.original_body_start as usize..],
        ]
        .concat();
        let patched = inspect_mkv_head(&virtual_full).unwrap();
        assert_eq!(patched.cues_in_head_points.len(), 2);
    }

    #[test]
    fn test_cues_cover_duration_checks() {
        assert!(!cues_cover_duration(&[(0, 100)], Some(60000.0), false));
        assert!(!cues_cover_duration(
            &[(0, 100), (1000, 200), (2000, 300)],
            Some(60000.0),
            false
        ));
        assert!(cues_cover_duration(
            &[(0, 100), (25000, 200), (45000, 300)],
            Some(60000.0),
            false
        ));
        assert!(cues_cover_duration(
            &[(0, 100), (1000, 200), (2000, 300), (3000, 400), (4000, 500)],
            Some(60000.0),
            true
        ));
    }

    #[test]
    fn test_truncated_mkv_detection_last_cluster_and_seg_clamp() {
        let full = make_synthetic_mkv(false, false);
        let full_info = inspect_mkv_head(&full).unwrap();
        // Simulate a truncated file that is shorter than Segment size claims
        let truncated_len = full.len() - 5;
        let truncated = &full[..truncated_len];
        let trunc_info = inspect_mkv_head(truncated).unwrap();

        let expected = trunc_info.expected_file_size().unwrap();
        assert_eq!(expected, full.len() as u64);
        assert!(expected > truncated.len() as u64);

        let last_cue = extract_last_cluster_cue_from_window(
            truncated,
            0,
            trunc_info.seg_data_start,
        )
        .expect("last cluster should extract");
        assert_eq!(last_cue.0, 5000);
        assert!((trunc_info.ticks_to_seconds(last_cue.0) - 5.0).abs() < 1e-6);

        let cue0 = extract_cluster_cue_from_window(
            &truncated[trunc_info.first_cluster_offset as usize..],
            trunc_info.first_cluster_offset,
            trunc_info.seg_data_start,
        )
        .unwrap();
        let overlay = build_virtual_mkv_patch(
            truncated,
            &trunc_info,
            truncated.len() as u64,
            &[cue0, last_cue],
        )
        .unwrap();
        let virtual_full = [
            overlay.prefix_bytes.as_slice(),
            &truncated[overlay.original_body_start as usize..],
        ]
        .concat();
        let patched_info = inspect_mkv_head(&virtual_full).unwrap();
        let (_, _, clamped_seg_sz) = patched_info.seg_size_span.unwrap();
        // Patched Segment size must match actual truncated virtual length, not original un-truncated length!
        assert_eq!(
            patched_info.seg_data_start + clamped_seg_sz,
            virtual_full.len() as u64
        );
        assert!(patched_info.seg_data_start + clamped_seg_sz < full_info.expected_file_size().unwrap() + (overlay.prefix_bytes.len() as u64));
    }
}
