// src-tauri/src/image_proxy.rs

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use reqwest::Url;
use tokio::sync::Semaphore;

const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024; // 单张图片最大 20 MiB 防护
const MAX_CONCURRENT_IMAGE_FETCHES: usize = 24;
const MAX_CACHED_CLIENTS: usize = 16;

static IMAGE_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
static IMAGE_CLIENTS: OnceLock<RwLock<HashMap<(String, String), reqwest::Client>>> = OnceLock::new();

fn semaphore() -> &'static Arc<Semaphore> {
    IMAGE_SEMAPHORE.get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_IMAGE_FETCHES)))
}

fn clients_pool() -> &'static RwLock<HashMap<(String, String), reqwest::Client>> {
    IMAGE_CLIENTS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn get_or_build_image_client(
    proxy_url: Option<&str>,
    user_agent: &str,
) -> Result<reqwest::Client, String> {
    let normalized_proxy = proxy_url.and_then(crate::proxy::normalize_proxy_url);
    let proxy_key = normalized_proxy.clone().unwrap_or_default();
    let cache_key = (proxy_key, user_agent.to_string());

    if let Ok(guard) = clients_pool().read() {
        if let Some(existing) = guard.get(&cache_key) {
            return Ok(existing.clone());
        }
    }

    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(25))
        .pool_max_idle_per_host(8);

    if let Some(ref px) = normalized_proxy {
        let proxy = reqwest::Proxy::all(px).map_err(|e| format!("图片代理配置无效 ({px}): {e}"))?;
        builder = builder.proxy(proxy);
    } else {
        builder = builder.no_proxy();
    }

    let built = builder
        .build()
        .map_err(|e| format!("构建图片请求客户端失败: {e}"))?;

    if let Ok(mut guard) = clients_pool().write() {
        if guard.len() >= MAX_CACHED_CLIENTS {
            guard.clear();
        }
        guard.insert(cache_key, built.clone());
    }

    Ok(built)
}

/// 校验并提取 `nocta-img` 查询参数中的目标图片 URL 与可选覆盖 User-Agent
pub fn extract_and_validate_image_target(
    raw_query: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let query = raw_query.unwrap_or("");
    let parser_url = Url::parse(&format!("http://localhost/?{query}"))
        .map_err(|e| format!("无效图片请求参数: {e}"))?;

    let mut target_url: Option<String> = None;
    let mut explicit_ua: Option<String> = None;

    for (k, v) in parser_url.query_pairs() {
        if k == "url" {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                target_url = Some(trimmed.to_string());
            }
        } else if k == "ua" {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                explicit_ua = Some(trimmed.to_string());
            }
        }
    }

    let target = target_url.ok_or_else(|| "缺少图片目标 url 参数".to_string())?;
    let parsed_target = Url::parse(&target).map_err(|e| format!("目标图片地址格式无效: {e}"))?;
    let scheme = parsed_target.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(format!("禁止访问非 HTTP/HTTPS 图片协议: {scheme}"));
    }

    Ok((target, explicit_ua))
}

fn build_error_response(status: u16, message: &str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

pub fn handle_image_protocol_request(
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let raw_query = request.uri().query().map(str::to_string);

    tauri::async_runtime::spawn(async move {
        let (target_url, explicit_ua) = match extract_and_validate_image_target(raw_query.as_deref()) {
            Ok(parsed) => parsed,
            Err(err) => {
                responder.respond(build_error_response(400, &err));
                return;
            }
        };

        let Ok(_permit) = semaphore().acquire().await else {
            responder.respond(build_error_response(503, "Image proxy shutdown"));
            return;
        };

        let (effective_proxy, resolved_ua) = crate::proxy::resolve_runtime_proxy_and_ua(&target_url);
        let final_ua = explicit_ua.unwrap_or(resolved_ua);

        let primary_client = match get_or_build_image_client(effective_proxy.as_deref(), &final_ua) {
            Ok(c) => c,
            Err(err) => {
                responder.respond(build_error_response(502, &err));
                return;
            }
        };

        let mut resp_result = primary_client.get(&target_url).send().await;
        if resp_result.is_err() && effective_proxy.is_some() {
            if let Ok(direct_client) = get_or_build_image_client(None, &final_ua) {
                resp_result = direct_client.get(&target_url).send().await;
            }
        }

        let mut upstream = match resp_result {
            Ok(r) => r,
            Err(err) => {
                responder.respond(build_error_response(502, &format!("拉取图片失败: {err}")));
                return;
            }
        };

        let status_code = upstream.status().as_u16();
        let content_type = upstream
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let mut body = Vec::new();
        while let Ok(Some(chunk)) = upstream.chunk().await {
            if body.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
                responder.respond(build_error_response(413, "图片体积超过安全上限"));
                return;
            }
            body.extend_from_slice(&chunk);
        }

        let cache_control = if (200..300).contains(&status_code) {
            "public, max-age=86400"
        } else {
            "no-store"
        };

        let response = tauri::http::Response::builder()
            .status(status_code)
            .header("Content-Type", content_type)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", cache_control)
            .body(body)
            .unwrap_or_else(|_| build_error_response(500, "构造图片响应失败"));

        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_and_validate_image_target_accepts_http_and_rejects_file_scheme() {
        let ok = extract_and_validate_image_target(Some(
            "url=https%3A%2F%2Femby.example.com%2Femby%2FItems%2F1%2FImages%2FPrimary%3FmaxWidth%3D400&v=2",
        ))
        .unwrap();
        assert_eq!(
            ok.0,
            "https://emby.example.com/emby/Items/1/Images/Primary?maxWidth=400"
        );
        assert!(ok.1.is_none());

        assert!(extract_and_validate_image_target(Some("url=file%3A%2F%2F%2Fetc%2Fpasswd")).is_err());
        assert!(extract_and_validate_image_target(Some("url=javascript%3Aalert(1)")).is_err());
        assert!(extract_and_validate_image_target(Some("v=1")).is_err());
    }
}
