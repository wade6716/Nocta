# Nocta (诺塔) · Agent Rules & Architecture Guardrails

**Nocta · 诺塔** 是基于 Tauri 2.0 构建的沉浸式私人影院客户端（支持明暗双主题），深度集成 Emby/Jellyfin 媒体库与独立音乐空间，支持全网弹幕自动匹配、手动绑定与 Canvas 渲染。

- 详细功能背景与迭代记录：[`MEMORY.md`](file:///d:/wade/code/emby-tauri-player/MEMORY.md)
- 视觉与交互设计规范：[`UI_UX_DESIGN_SPEC.md`](file:///d:/wade/code/emby-tauri-player/UI_UX_DESIGN_SPEC.md)

---

## 一、不可违背的硬性约束 (Hard Rules)

1. **Git 提交身份**：必须使用用户名 `Wade` 与 GitHub 隐私邮箱 `59910348+wade6716@users.noreply.github.com`，严禁使用未授权或真实外部邮箱。
2. **弹幕客户端纯粹性**：绝不捆绑/打包任何服务端程序（含 `danmu_api`），仅作纯 HTTP 消费者；Token 必须直接包含在 API 地址中，UI 不得增加独立 Token 输入框。
3. **弹幕测速路由**：节点探测必须使用 `${base}/api/config`（回退 `POST /api/v2/match` 或 `GET /`）；**严禁使用 `/api/v2/version`**（`danmu_api` 中不存在，会 404 误报离线）。
4. **媒体库视频纯净与剧集合并**：“继续观看”与“最近播放”严禁展示音频/歌单等非视频内容；同剧多集必须经 `mergeMediaBySeries` 合并，仅保留最新单集与进度。
5. **品牌与图标**：主品牌统一为 `Nocta · 诺塔`（已由「夜幕」更名）；图标母版 [`app-icon.svg`](file:///d:/wade/code/emby-tauri-player/app-icon.svg) 更新后须运行 `pnpm tauri icon app-icon.svg` 同步生成 `src-tauri/icons/`。
6. **构建验证**：提交任何变更前必须运行 `pnpm build`（`tsc && vite build`）确保零错误。
7. **提交前先同步远程**：提交前先 `git pull`；工作区有他人未提交改动时用 `git fetch && git merge origin/main`，**禁止 `git rebase --autostash`**。仅显式 `git add <files>` 提交本次任务文件，严禁 `git add -A` / `git add .`。
8. **文档治理与防膨胀**：本文件**只记录硬性约束与跨任务高危架构红线**，总大小**严格控制在 20 KB 以内**以免系统注入截断。更新时须**原地合并/覆写对应章节并删除过时条款**，严禁按时间无限追加新节；普通功能说明与迭代流水归档至 `MEMORY.md` 或 `UI_UX_DESIGN_SPEC.md`。

---

## 二、核心架构红线与排坑指南

### 1. Emby 媒体库、搜索、图片与零转码直链
- **跨库穿透与多服聚合搜索**：许多库被管理员「从全局搜索中排除」。搜索须经 `getCachedSearchViews`（5 分钟 TTL，取 `getUserViews().Items` 并排除 `music`/`photos`）并发带 `ParentId` 穿透检索并注入 `LibraryName`/`LibraryId`；`IncludeItemTypes` 须含 `Movie,Series,Episode,Video,BoxSet`，搜索经 `mergeMediaBySeries(items, { preferSeries: true })` 保留剧集主体。多服联合检索调用 `searchFederatedMediaItems` 流式回调 + 独立 `timeoutMs`，[`SearchPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/SearchPage.tsx) 用 `searchReqIdRef` 防过期竞态。
- **跨服卡片与切服同步**：多服条目注入 `ServerId`/`ServerName`/`ServerUrl`，海报寻址优先 `item.ServerUrl || serverUrl`。全站任意路由可切服，点击跨服条目或切服前必须调用 `setCurrentServer` 与 `clearMediaCache()`（递增 `cacheVersion`）并自动回到对应空间首页，[`HomePage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/HomePage.tsx) 用 `loadReqIdRef` 丢弃旧服慢响应。
- **剧集总集数、`Episode` 归属与首页卡片元数据**：`Series` 总集数取 `RecursiveItemCount`，API `Fields` 须显式包含 `ChildCount,RecursiveItemCount,Status`，且首页/续播接口（`PLAYBACK_MEDIA_FIELDS` 与 `getLatestItems`）须包含 `ProductionYear,PremiereDate,Genres,OfficialRating,RunTimeTicks,Taglines` 防缺年份流派。[`DetailPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/DetailPage.tsx) 遇 `Episode && SeriesId` 须并发拉父级 `Series` 详情；分集 `Backdrop` 优先取 `ParentBackdropItemId || SeriesId` 配 `ParentBackdropImageTags?.[0]`。
- **无 `tag` 图片 500 防护 ([`embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts))**：部分 `.strm`/未刮削条目无 `&tag=` 或强转 `&format=webp` 会触发服务端 `.NET NullReferenceException (500)`。**严禁盲发无 `tag` 图片请求或在 `onError` 中剥离 `&tag=` 重试**；统一走 `resolveEpisodeThumbnailUrl` / `resolveItemPosterUrl` / `resolveItemBackdropUrl`（无 tag 直接本地占位、零网络请求），`onError` 须带步进锁仅 via `stripImageFormatWebp` 剥离 `&format=webp`（保留 `&tag=`）重试一次。
- **100% 零转码原画直出 & 多版本择优**：视频流仅允许 `static=true` 直出，**严禁请求实时转码或 MP4 重封装**；HTML5 不支持格式直接报错并引导切 MPV。`buildNativeDirectStreamUrl` 优先 `DirectStreamUrl` → 标准 `/stream.{ext}?static=true` 并规范化容器后缀，**绝不能绕过服务端 302/307 重写直接优先返回 `.strm` (`IsRemote`) 陈旧 `mediaSource.Path`**（仅作末位 fallback）。所有起播统一经 [`playbackSessionService.ts`](file:///d:/wade/code/emby-tauri-player/src/player/playbackSessionService.ts) `sortMediaSourcesByQuality` 择优（禁直取 `MediaSources[0]`）。
- **统一默认 UA 与客户端名**：前后端（`embyClient.ts`、[`preload.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/preload.rs)、[`proxy.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/proxy.rs)）统一默认 UA `Nocta/${APP_VERSION} (Desktop; EmbyClient)` 与 `Client="Nocta"`；`buildEmbyHeaders` 仅在 `isTauriEnvironment()` 为 `true` 时注入 `User-Agent`，避免浏览器 Dev 模式禁改头警告。

### 2. 播放器引擎 (`libmpv` / HTML5)、缓冲与切集生命周期
- **FFI 内存安全与实例复用红线**：
  - **严禁调用 `getProperty(..., 'node')`**（`nini22P/libmpv-wrapper` 栈指针 8 字节而 C API 写 16 字节 `mpv_node` 必现栈溢出崩溃），复杂/数值属性一律通过 `observeProperties` 获取。
  - **严禁调用 `tauri-plugin-libmpv` 的 `destroy()`**（存在 UAF 竞态）。`'main'` 实例进程级复用，离页仅解绑监听并 `setProperty('pause', true)` + `command('stop')`。
- **MPV 参数与起播生命周期 ([`MpvPlayerEngine.ts`](file:///d:/wade/code/emby-tauri-player/src/player/MpvPlayerEngine.ts))**：
  - `X-Emby-Authorization` 含逗号，**严禁 `setProperty('http-header-fields', ...)`**，须用 `command('change-list', ['http-header-fields', 'clr', ''])` 后逐条 `append`；`demuxer-max-bytes` 与 `demuxer-max-back-bytes` 须以 `String(bytes)` 字符串下发。
  - **严禁在 `loadfile` 后同步调用 `command('seek')`**：须在 `loadfile` 前预设 `start`、`this._currentTime = 0`，在 `file-loaded` 后执行带 `try/catch` 绝对寻址，在 `playback-restart` 后重置 `start='none'`。保留 `force-seekable: 'yes'`、`demuxer-seekable-cache: 'yes'`、`hr-seek-framedrop: 'yes'`、`demuxer-mkv-subtitle-preroll: 'no'` 防 MKV 远端顺序下载死锁；`lifecycleQueue` 串行化 `init`/`destroy`。
- **进度保护、片头/片尾跳过与切集隔离**：
  - 用 `hasInitialSeekedRef` 拦截首跳前 0 秒 `onTimeUpdate`；停播/切集上报读现场秒数或 `lastValidTimeRef.current` 并以 `reportedStoppedSessionRef` 防覆盖，禁读旧闭包 `currentTime`；距片尾 `< 15s` 或 `> 98%` 视作完播。
  - 跳过片尾（[`useSkipSegmentsController.ts`](file:///d:/wade/code/emby-tauri-player/src/player/hooks/useSkipSegmentsController.ts)）有 `nextEpisode` 时直接 `switchToEpisode`，无下一集时 `seek(total - 1)`（**严禁 `seek(total - 0.25)`** 导致 `Math.ceil` 卡死片尾）；切集通过 `loadEpoch`（拦截非当前 epoch 的 `time-pos`/`duration`/`end-file`）与 [`PlayerPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/PlayerPage.tsx) `isSwitchingEpisodeRef` + 立即 `pause()` 隔离旧流；`SkipSegments` 变更走 `saveStorageImmediate` 即时落盘。
- **动态时长缓冲与纯内存预加载 ([`preload.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/preload.rs) / [`useNextEpisodePreloader.ts`](file:///d:/wade/code/emby-tauri-player/src/player/hooks/useNextEpisodePreloader.ts))**：
  - `setBufferConfig` 协同下发 `demuxer-readahead-secs`（默认 5 分钟）与受 `cacheMemoryCapMB` 约束的 `demuxer-max-bytes` 防 OOM。
  - 预加载用 1 MiB 内存分块（零磁盘 IO），**严禁持 `RwLock` 跨越 `.await`**；文件大小用 `GET Range: bytes=0-0` 探测；302 跨域必须剥离 `authorization`/`X-Emby-*`；切入预载集立即 `abort()` 下载，稳定起播后调用 `release_active_preload_memory` 释分块保透传；`-13` 自动 `diagnose_stream_url` 逐跳排查并在 Rust 可达时单次降级零内存 `start_stream_relay`。
- **缓冲态解耦**：播放中缓冲仅显示 `pointer-events-none` 的 [`BufferingIndicator.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/player/BufferingIndicator.tsx)，**严禁拉起全屏 `isLoadingVideo` 或强制显示 OSD**。

### 3. 视窗穿透、主题毛玻璃与 macOS 原生窗口/全屏浮层
- **透明穿透与原生毛玻璃隔离**：[`index.css`](file:///d:/wade/code/emby-tauri-player/src/index.css) 的 `html, body, #root` 必须保持 `background-color: transparent;`；进入 `/player/*` 时 [`App.tsx`](file:///d:/wade/code/emby-tauri-player/src/App.tsx) `<main>` 透明且**必须立即调用 `set_window_glass_effect("off")` 清除原生 Acrylic / UnderWindowBackground**（[`lib.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/lib.rs)），严禁遮挡底层 `libmpv`。
- **透明 WebView 叠层与 Tailwind v3 红线**：Windows 透明 WebView2 上悬浮于视频画面的浮层**严禁大半径外阴影**（产生 1px 黑色轮廓伪影），且 `backdrop-blur-*` 无法模糊原生底层视频，须用高不透明深色底（如 `bg-[#0B0E17]/95`）+ `border-white/15`。Tailwind v3 透明度修饰符**必须为 5 的倍数或方括号任意值**（如 `/95`、`/[0.92]`、`z-[35]`），裸非 5 倍数会被静默丢弃。
- **双主题视觉与详情/冷启动约束**：亮色主画布采用纯净不透明 `#FFFFFF`（`#F5F5F7` 用于侧边栏/分组，`<main>` 须实色 `bg-canvas` 防背后窗口透字，禁叠青/紫径向光斑）、暗色 `#0A0A0C`，亮色互动主色收敛为 `#1D1D1F` 单色高对比；首页与详情页均全出血并用 `scrollProgress` 连续插值顶栏透明度与动态剧照环境柔光带（亮色 Hero 禁底部白雾）；`DetailPage` Hero 背景须在容器内用 `absolute inset-0`（**禁 `fixed -z-10`**）；无服务器冷启动须保留直达 `/settings?tab=sync` 的配置恢复入口。
- **macOS 原生交通灯、嵌入与焦点恢复**：禁 CSS 模拟交通灯，由 [`tauri.macos.conf.json`](file:///d:/wade/code/emby-tauri-player/src-tauri/tauri.macos.conf.json) 配置 Overlay 交通灯；[`mpv_embed_macos.m`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/mpv_embed_macos.m) 在主线程以 `addChildWindow` 嵌入 mpv 窗口（选项为 `input-cursor-passthrough`，AppKit 须经 `run_on_main_thread`）；无边框窗口退全屏后 `tao` 会重置 `firstResponder` 导致失焦，须经 `nocta_configure_main_window` 与 `nocta_focus_webview` 异步恢复 `WKWebView` 焦点，`KeyF` 防 `e.repeat` 连发。
- **macOS 原生全屏 OSD 浮层 ([`osd_overlay.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/osd_overlay.rs) / [`OsdOverlayPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/OsdOverlayPage.tsx))**：**仅 `macOS + engineType === 'mpv' + 原生全屏` 启用** `osd-overlay`；`show()` 后重设 `NSStatusWindowLevel` 与 `FullScreenAuxiliary`，遇 `label already exists` 视为成功。主窗口与浮层经 [`osdOverlaySync.ts`](file:///d:/wade/code/emby-tauri-player/src/player/osdOverlaySync.ts) + Revision 防环锁同步；浮层仅 `applyRemoteStoreSnapshot(..., false)` 更新内存，**严禁直接写盘、调引擎或 Emby API**，所有操作经 `osd:command` 回传主窗口。

### 4. 弹幕系统与零闪烁渲染
- **CI 源码直编 ([`vite.config.ts`](file:///d:/wade/code/emby-tauri-player/vite.config.ts))**：`danmaku` 须优先解析 `src/index.js` 并保留在 `optimizeDeps.exclude`，严禁 CI 退回旧 `dist/`。
- **零闪烁与按需懒加载**：`formattedComments` 的 `useMemo` **严禁依赖 `visible`/`opacity`/`speed`/`area`/`maxLines`/`bottomMargin`/`showHeatmap`**，防拖滑块 Canvas 重建闪烁。[`useDanmakuSession.ts`](file:///d:/wade/code/emby-tauri-player/src/player/hooks/useDanmakuSession.ts) 仅在 `visible === true` 时触发，用 `effectiveDurationRef` 读时长（**严禁将 `effectiveDuration` 加入 `triggerDanmakuLoad` 依赖**），并用 `danmakuReqIdRef` + `activeItemIdRef` 防竞态。
- **两阶段匹配、熔断与分集解析 ([`danmuClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/danmuClient.ts))**：Stage 1 (`POST /api/v2/match`) 0 弹幕或时长偏差超阈值回退 Stage 2 关键词搜索（绝不拼 `@preferredPlatform`），仅严格更优才替换；仅网络/超时/`401`/`403`/`429`/`5xx` 触发指数熔断，`200` 空/`404` 不惩罚；[`DanmakuDrawer.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/player/DanmakuDrawer.tsx) 经 `parseDanmuEpisodeInfo` 剥离平台前缀（不剥 `SP`/`OVA` 等），选集定位用容器 `scrollTo`（禁 `scrollIntoView`），拉取用独立 `bindingEpisodeId` 防卸载列表。

### 5. 全栈网络代理、域名收集与配置同步
- **HTTP 作用域与 TLS ([`default.json`](file:///d:/wade/code/emby-tauri-player/src-tauri/capabilities/default.json) / [`http.ts`](file:///d:/wade/code/emby-tauri-player/src/api/http.ts))**：`http:allow-fetch` 须包含显式端口通配（`http://*:*`、`http://*:*/*`、`http://*:*/**` 及对应 `https`），避开 WHATWG URLPattern 默认端口限制；`httpClient` 默认容忍自签证书并将 `socks5://` 升为 `socks5h://`。
- **OS 跳过代理与分层路由**：前后端对齐 `shouldBypassProxy` / `should_bypass_proxy` 严格遵循系统跳过代理列表（含 CIDR/`<local>`/通配），**严禁硬编码旁路私网/局域网地址**。MPV 遇 `socks5` 经 Rust `ensure_socks5_http_bridge` 建 HTTP 桥，Rust 预加载/中转走原生 `rustProxy`，本机环回流强制直连；WebDAV/S3/Updater 显式传 `getGlobalProxyConfig()` 与单服 Emby 代理隔离。
- **`nocta-img` 图片代理 & 域名收集**：Emby 图片经 `wrapEmbyImageUrl` 走 [`image_proxy.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/image_proxy.rs) 遵循应用代理与 UA，变更配置递增 `imageProxyRevision` 触发重载；[`useEmbyHostsStore.ts`](file:///d:/wade/code/emby-tauri-player/src/stores/useEmbyHostsStore.ts) 禁导入 `useAuthStore` 防循环依赖，样本自动脱敏。
- **同步与本地导出**：WebDAV/S3 走 `httpClient`（Tauri 下 WebDAV 置空 `Origin: ''`，400 自动升 HTTPS，404/409 自动 `MKCOL`）；Windows SMB 走 Win32 `WNetAddConnection2W`；Windows 打开下载目录直接 `explorer <dir>`（**严禁 `/select,"<Path>"`** 防回退文档目录）。

### 6. 双空间隔离（影视 / 音乐）、Keep-Alive 与系统媒体会话
- **影视/音乐强隔离 ([`embyMusicClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyMusicClient.ts) / [`MusicAudioController.tsx`](file:///d:/wade/code/emby-tauri-player/src/music/MusicAudioController.tsx))**：音乐接口须限定 `CollectionType === 'music'` 视图 `ParentId` + `MediaTypes=Audio` + 客户端严格白名单；进 `/player/*` 自动暂停音乐，非视频路由由音乐控制器接管媒体会话。
- **Keep-Alive 门控**：隐藏态保活页（`/`、`/continue-watching`、`/search`）须以 `isActive` 门控快捷键与自动 `focus()`；离 `/player/*` 递增 `playbackDirtyRevision` 静默增量刷新。
- **媒体会话与耳机断连 ([`media_session.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/media_session.rs))**：`lib.rs` 中 `.manage(MediaSessionState::default())` 须在 `.setup()` 前调用；Linux `souvlaki` 用 `use_zbus`（免 `libdbus-1-dev`）；Windows 在 [`Cargo.toml`](file:///d:/wade/code/emby-tauri-player/src-tauri/Cargo.toml) 同时声明 `windows-core`；外放切耳机不误停，耳机断开/切回扬声器自动暂停。

### 7. `libmpv` 动态库打包与本地开发前置
- **本地缺库检查**：新克隆或 `src-tauri/lib/` 仅剩 `.gitkeep` 时先运行 `pnpm setup-mpv`（[`setup-mpv.mjs`](file:///d:/wade/code/emby-tauri-player/scripts/setup-mpv.mjs) 在 macOS 找不到 Homebrew `libmpv` 时必须失败）并重启 `pnpm tauri dev`。
- **Windows DLL 126 防护**：Rust 入口调用 `SetDllDirectoryW` 并前置写入 `PATH` 注入 `lib/`，保障二级依赖 `libmpv-2.dll` 加载。
- **macOS 自包含与防双份加载**：`ensure_unix_symlink` 遇旧指向须删除重建，禁同进程加载两份 `libmpv`；通过 `[patch.crates-io]` 本地 `tauri-plugin-libmpv` 扩展 `Contents/Resources/lib` 寻址 + `RTLD_GLOBAL` 预加载；复制 Homebrew 只读 dylib 后须 `chmod 0755`。

### 8. CI/CD 发版、缓存与自动更新 ([`release.yml`](file:///d:/wade/code/emby-tauri-player/.github/workflows/release.yml) / [`ci.yml`](file:///d:/wade/code/emby-tauri-player/.github/workflows/ci.yml) / [`useUpdaterStore.ts`](file:///d:/wade/code/emby-tauri-player/src/stores/useUpdaterStore.ts))
- **单一版本源与 `main` 发版**：[`tauri.conf.json`](file:///d:/wade/code/emby-tauri-player/src-tauri/tauri.conf.json) 用 `"version": "../package.json"`，前端注入 `__APP_VERSION__`。`release.yml` 仅监听 `push: branches: [main]` 与 `workflow_dispatch`（禁设 `push.tags`），由 `build-frontend` 检查远端 `v<version>` Tag 决定 `should_release`。仅 `github.ref == 'refs/heads/main'` 写缓存（`save-if`），禁 `sccache` + `rust-cache` 叠加超 10 GB 配额；`ci.yml` 仅手动触发。
- **多端编译避坑**：`build-frontend` 单次编前端并预创建 `release_id`（防 4 端并发 422）；矩阵用 [`tauri.ci.conf.json`](file:///d:/wade/code/emby-tauri-player/src-tauri/tauri.ci.conf.json) 与预编译 `cargo-tauri`；Windows NSIS 在 `ubuntu-24.04` 用 `cargo-xwin`（**切勿调用 `llvm-rc --version`**）；macOS Intel 在 `macos-15` 交叉编译，仅 `mpv-bundle` 失效时拉起 `prepare-macos-x64-mpv`（**切勿 `rm -f src-tauri/lib/libmpv*.dylib`** 误删 wrapper），改打包脚本须递增 `mpv_cache_version`；`finalize-release` 须显式写 `if: always() && ...` 防上游 `skipped` 误跳过。
- **自动更新与双通道清单**：`tauri.ci.conf.json` 默认 `"createUpdaterArtifacts": false`，校验 `TAURI_SIGNING_PRIVATE_KEY` 非空后动态开启；矩阵 `includeUpdaterJson: false`，macOS 须 `--bundles app,dmg`；`finalize-release` 清理旧资产豁免 `latest.json`/`*.sig`/`*.tar.gz`，调用 [`generate-updater-manifest.mjs`](file:///d:/wade/code/emby-tauri-player/scripts/generate-updater-manifest.mjs) 与 [`generate-release-notes.mjs`](file:///d:/wade/code/emby-tauri-player/scripts/generate-release-notes.mjs) 推送清单至 `updater-manifests` 分支；`Cargo.toml` 保留 `updater-reqwest-socks` 统一 `reqwest 0.13` SOCKS 特性；发版前优先在 [`CHANGELOG.md`](file:///d:/wade/code/emby-tauri-player/CHANGELOG.md) 补中文更新亮点。
