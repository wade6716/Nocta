# Nocta (夜幕) · Agent Rules & Project Guide

欢迎协助开发 **Nocta · 夜幕**（基于 Tauri 2.0 构建的暗色沉浸式私人影院客户端，深度集成 Emby/Jellyfin 媒体库，支持全网弹幕自动匹配、手动搜索绑定与彩色 Canvas 高性能渲染）。

在开始任何新任务前，请务必先查阅项目完整上下文记忆文档：
👉 [MEMORY.md](file:///d:/wade/code/emby-tauri-player/MEMORY.md)

---

## 核心开发准则与不可违背的硬性约束 (Hard Rules)

1. **Git 提交身份约束**：
   - 必须使用配置的 GitHub 隐私邮箱提交：`59910348+wade6716@users.noreply.github.com`，用户名 `Wade`。
   - 严禁使用未授权或真实个人外部邮箱，否则会被 GitHub remote rejected 拒绝推送。

2. **弹幕客户端纯粹性**：
   - 客户端**绝不能捆绑或打包任何服务端程序**（包括 `danmu_api`）。客户端仅作为纯 HTTP 消费者。
   - **Token 必须直接包含在 API 地址中**（例如 `http://127.0.0.1:9321/87654321` 或 `http://vps:9321/my_token`），UI 中**不得**增加单独的 Token 输入框。

3. **弹幕节点测试 Ping 路由**：
   - 探测测速必须使用 `${base}/api/config` 并支持回退到 `POST /api/v2/match` 或 `GET /`。
   - **绝对不能使用 `/api/v2/version`**，该接口在 `danmu_api` 中不存在（会导致 404 误报离线）。

4. **媒体库播放列表约束**：
   - “继续观看”（Resume）和“最近播放”（Recently Played）中**严禁展示任何非视频内容**（彻底排除音乐、歌单、音频）。
   - 同一部电视剧的多集在“继续观看”中必须调用 `mergeMediaBySeries` 进行合并，仅保留最新观看的那一集和播放进度。

5. **图标与品牌规范**：
   - 应用主品牌：`Nocta · 夜幕`（窗口标题栏统一显示 `Nocta · 夜幕` 并附带应用 Logo）。
   - 图标母版为根目录的 `app-icon.svg`。每次更新母版后，需执行 `pnpm tauri icon app-icon.svg` 自动同步编译全平台图标至 `src-tauri/icons/`。

6. **代码构建验证**：
   - 提交任何变更前，必须运行 `pnpm build`（`tsc && vite build`）确保编译零错误。

7. **提交前必须先同步远程（Pull Before Commit）**：
   - **每次提交代码前务必先 `git pull`**（即 `git fetch` 后整合 `origin/main`），确保基于远程最新提交，避免推送被拒或造成历史分叉。
   - 若工作区存在其他人/其他会话的未提交改动，请使用 `git fetch` + `git merge origin/main`；**禁止使用 `git rebase --autostash`**（会临时搬移他人未提交文件，存在冲突或丢失风险）。
   - **只提交本次任务自己的文件**（`git add` 后显式列出路径），严禁 `git add -A` / `git add .` 把他人尚未提交的在制品一并带入提交。
   - 若拉取后产生冲突或 `pnpm build` 因他人在制品报错，先解决冲突/等待对方完成，不得强行推送。

8. **任务闭环与知识自动沉淀约束（Post-Task Knowledge Synchronization）**：
   - **每次完成任务后，必须自动将本次开发中沉淀出的可复用技术经验、避坑要点与业务规则写入本 `AGENTS.md`**（并在需要时同步详细背景至 `MEMORY.md`）。
   - 形成自我迭代的知识闭环，确保后续所有会话与 Agent 能立即复用既有经验，坚决杜绝同类问题重复踩坑。

---

## 核心架构经验与排坑指南 (Reusable Technical Guide)

### 1. 跨媒体库深度聚合检索穿透
- **服务端全局排除避坑**：Emby / Jellyfin 许多特定库（如动漫、纪录片、4K、短片等）管理员常勾选「从全局搜索中排除」，直接调用无 `ParentId` 的全局搜索接口会导致漏检。
- **穿透方案**：必须先获取用户可用视图 `getUserViews`（**注意**：其返回结构为 `{ Items: EmbyItem[]; TotalRecordCount: number }`，必须取 `.Items` 并排除 `music`/`photos`），然后并发对每个媒体库带上 `ParentId=${view.Id}` 发起深度检索，与全局检索及 `/emby/Search/Hints` 进行聚合去重。
- **类型过滤**：`IncludeItemTypes` 必须包含 `Movie,Series,Episode,Video,BoxSet`，再由前端通过 `isVideoMedia` 与 `mergeMediaBySeries` 统一过滤合并。
- **所属库回填**：必须为搜索结果条目注入 `LibraryName` / `LibraryId`，以便在卡片上明确提示来源媒体库。

### 2. 原生播放器双层穿透视窗 (Window Layering)
- **全局背景色透明要求**：`src/index.css` 的 `html, body, #root` 必须保持 `background-color: transparent;`。深色背景必须由 `App.tsx` 在非播放路由动态赋予。一旦 `#root` 设置了不透明背景，WebView2 将遮挡底层 Win32/Direct3D 视频画面，导致「只有弹幕黑屏飞过、无视频画面」。
- **系统代理透传**：Windows 下 `libmpv` 不会自动读取注册表系统代理。必须通过 Rust 命令探知系统代理并在播放引擎初始化与加载视频时动态注入 `http-proxy`。

### 3. 播放进度与状态防冲刷保护
- **初始首跳防冲刷**：原生 `<video>` 初始加载时会派发 0 秒的 `onTimeUpdate`。必须使用 `hasInitialSeekedRef` 标记，首跳前拦截 0 秒事件，防止瞬时覆盖全局真实进度。
- **闭包过时防护**：销毁上报与心跳定时器中，禁止直接读取旧闭包中的 `currentTime`，必须通过 `videoElemRef.current?.currentTime ?? usePlayerStore.getState().currentTime` 获取现场真实秒数。
- **完播防回滚**：当进度距片尾不足 15 秒或超过 98% 时，视为完播，下次重新起播应从 0:00 开始。

### 4. 多端配置同步与本地备份设计准则 (Sync & Backup Architecture)
- **敏感信息安全与端到端加密 (E2EE)**：
  - 本地导出支持脱敏开关（清除密码与 Access Token），并支持可选加密密码。
  - 多端同步支持端到端同步密钥（Passphrase）：基于 Web Crypto API 使用 PBKDF2 (100,000 次 SHA-256 迭代) + AES-256-GCM 强加密。云端仅存储密文，彻底杜绝 Emby 凭据在公网 S3 或共享盘泄露。
- **SMB 局域网协议穿透**：
  - 在 Windows 平台，通过 Rust FFI 调用 Windows 原生 `WNetAddConnection2W` (链接系统库 `mpr`) 建立临时网络凭据会话，通过 UNC 路径 `\\host\share\path` 直接借助 `std::fs` 读写，完美支持 SMB 2/3、NTLMv2，无跨平台三方库的兼容性缺陷。
  - macOS / Linux 环境下直接使用标准挂载路径（如 `/Volumes/...` 或 `/mnt/...`）进行透明文件读写。
- **WebDAV 与 S3 驱动架构**：
  - `src-tauri/Cargo.toml` 为 `tauri-plugin-http` 启用 `dangerous-settings` 与 `unsafe-headers` 特性；`httpClient` 默认配置 `danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true }` 以兼容局域网 NAS / 自建 Emby 的自签名 HTTPS 证书，并在代理不可达时自动回退无代理直连（通过 `noProxy: '*'` 彻底旁路系统代理）。
  - WebDAV 直接依托统一 `httpClient` 发送 `PUT` / `GET` / `MKCOL` / Basic Auth，在 Tauri 环境下显式置空 `Origin: ''` 去除 `tauri://localhost`Origin 校验风险；当 `http://` 请求遇到纯 HTTP 误连 HTTPS 端口返回的 `400 Bad Request`（如 Synology 5006 / Caddy 等）时自动升级为 `https://` 重试并回写同步配置；首次写入遇到 `404`/`409` 时自动尝试 `MKCOL` 创建父级子目录。
  - S3 采用轻量级 `aws4fetch` 计算 AWS SigV4 规范签名，随后将签名头交由 `httpClient` 发送，实现对 AWS S3、Cloudflare R2、MinIO、阿里云 OSS、腾讯云 COS 的全兼容与代理继承。
- **双向智能合并算法 (Smart Merge)**：
  - Emby 服务器：按 `url + username` 联合唯一标识合并，去重保留并集；导入脱敏配置时必须自动保留本机已有密码与 Token；活跃时间戳更新的一方优先。
  - 弹幕节点：按 `baseUrl` 去重合并。
  - 弹幕绑定：按 `itemId` 字典合并，以最新 `boundAt` 时间戳优先，保证各端绑定的剧集弹幕互补而不被抹除。
  - 弹幕屏蔽词：数组去重求并集。

### 5. 跨多个 Emby 服务器联合聚合搜索 (Federated Multi-Server Search)
- **多服并发联合检索与容错机制**：
  - 调用 `searchFederatedMediaItems(targets, params)`，利用 `Promise.allSettled` 并发检索全部已配置的 Emby 服务器（各服务器内部依然自动穿透全部分类库）；
  - 任何单台服务器超时、凭据失效或离线时，通过独立的 try-catch 容错捕获并记录在 `stats` 中，绝不能让单台故障抛出异常阻断其他健康服务器的搜索结果呈现；
- **条目来源标定与多服海报寻址**：
  - 搜索结果条目必须注入所在服务器信息：`ServerId`、`ServerName`、`ServerUrl`；
  - `MediaCard` 海报封面寻址必须优先使用 `effectiveServerUrl = item.ServerUrl || serverUrl`，防止向非当前主服务器请求图片导致 401/404；
  - 卡片左上角渲染来源服务器微标（`serverBadge || item.ServerName`），右上角渲染媒体库或剧集分类；
- **跨服点击无缝迁移**：
  - 用户点击非当前服务器的影视卡片时，在 `navigate('/detail/' + item.Id)` 前，必须同步调用 `useAuthStore.getState().setCurrentServer(target.id)` 并执行 `useMediaStore.getState().clearMediaCache()`，确保详情页和播放页直接使用目标服务器的 Token 与直链播放，彻底避免跨服会话错乱。

### 6. 电视剧集数（媒体文件）角标展示与 API 字段规范
- **Emby 服务端集数字段特性**：
  - 在 Emby / Jellyfin 中，`Series`（电视剧系列）条目的总集数（包含的媒体文件数）为 `RecursiveItemCount`；`ChildCount` 通常为季（Season）数或直属子项数；
  - Emby API 请求（`/emby/Users/{UserId}/Items`、`/Items/Latest` 等）必须显式在 `Fields` 参数中声明 `ChildCount,RecursiveItemCount,Status`，否则服务端默认会裁剪这些计数属性导致前端无法获取集数；
- **智能文案规则 (`formatSeriesEpisodeBadge`)**：
  - 连载中（`Status === 'Continuing'`）：展示为 `更新至 X 集`；
  - 已完结（`Status === 'Ended'`）：展示为 `全 X 集`；
  - 其它/未标注完结状态：展示为 `共 X 集`；
  - 单集分集条目（`Episode`）：展示为 `第 X 集`；
- **卡片四角非遮挡布局**：
  - 左上角：服务器来源微标（`serverBadge`）；
  - 右上角：媒体库分类徽章（`badge`，如 `动漫`、`电影`）或 `已看`；
  - 右下角：剧集总集数角标（`effectiveEpisodeBadge`，带 `Tv` 图标与深色半透毛玻璃背景），位于底部细线进度条上方，互不遮挡。

### 7. 播放器详细播放信息与媒体统计面板规范 (Playback Information & Stats HUD)
- **非阻断式 HUD 视窗设计**：
  - 采用半透明毛玻璃浮层（`bg-[#12151d]/90 backdrop-blur-xl`，`z-35`），浮动在播放器画面右上角/中央，允许用户在不暂停或不阻断播放的前提下实时观察视频色深、帧率、HDR 格式、音频声道和码率；
  - 快捷入口：OSD 控制栏右侧常驻信息入口按钮（`<Info />`），全局快捷键 `I`（Info）快捷打开/关闭，按 `Escape` 优先关闭；
- **技术参数细分体系（6大模块）**：
  1. 当前回放状态：播放进度、倍速、传输模式（DirectStream 直连/转码）、服务器名称；
  2. 视频流参数：分辨率（4K/1080p 等）、编码格式（HEVC/AVC/AV1 等）、帧率（fps）、色深（10-bit/8-bit）、动态范围（HDR10/Dolby Vision/SDR）、Profile/Level、码率；
  3. 音频流参数：当前音轨语言与标题、编码格式（TrueHD/DTS-HD/FLAC/AAC 等）、声道布局（7.1/5.1/立体声）、采样率（kHz）、码率；
  4. 字幕流参数：当前字幕标题与语言、格式（ASS/SRT/PGS 等）、外挂或内嵌状态；
  5. 播放引擎与渲染：内核类型（libmpv / HTML5）、GPU 硬件加速状态、渲染器；
  6. 弹幕与存储容器：匹配弹幕源标题、弹幕总条数、时间偏移、文件封装容器（mkv/mp4）及服务器物理路径；
- **一键技术支持复制（Copy to Clipboard）**：
  - 提供一键复制全部纯文本参数功能，方便用户向服务端管理员或开发者提供完整的故障排查报告。

### 8. 版本发布与 GitHub Actions 自动化打包规范 (Release & Packaging Pipeline)
- **版本号格式规范与 Windows MSI 避坑**：
  - Windows MSI (WiX) 安装包生成器要求版本格式必须为纯数字（`major.minor.patch`，如 `0.1.0`），如果 `src-tauri/tauri.conf.json` 中配置了非数字后缀（如 `0.1.0-alpha.2`），打包时会直接报错中断。
  - 因此，Pre-release 版本（Alpha / Beta / RC）必须将版本标记在 `package.json`（如 `0.1.0-alpha.10`）与 Git tag `v0.1.0-alpha.10`，由 CI 自动识别 `(alpha|beta|rc)` 为预发布状态，`tauri.conf.json` 保持为标准数字 SemVer（`0.1.0`）；
- **GitHub Actions Tag 缓存隔离避坑与推荐发版流程**：
  - **缓存作用域原理**：GitHub Actions 原生缓存严格按 `github.ref` 隔离——新推 Tag（`refs/tags/v0.1.0-alpha.11`）无法读取旧 Tag（`alpha.10`）的缓存，只能回退读取默认分支 `refs/heads/main`。若只在推 Tag 时构建 Release，`main` 作用域长期没有 Release 缓存，会导致 4 端每次 100% 冷编译。
  - **推荐日常发版方式（`workflow_dispatch` on `main`）**：
    1. 更新 `package.json`（及界面显示版本号）并运行 `pnpm build`、`cargo check`；
    2. 提交并推送到 `main` 分支；
    3. 在 GitHub Actions 页面执行 **Release → Run workflow**（保持默认分支 `main`，`tag_name` 留空即可自动读取 `package.json` 生成 `v<version>`，并由 `tauri-action` 自动创建 Tag 与 Release）。该方式直接读写 `main` 共享缓存池，实现全链路热缓存命中。
  - **兼容传统 Tag 触发**：仍保留 `on.push.tags: ['v*']`；推 Tag 构建时只读继承 `main` 上已有缓存，并通过 `save-if: ${{ github.ref == 'refs/heads/main' }}` 与条件 `actions/cache/save` 避免向孤立 Tag 作用域上传不会再被读取的死缓存。
- **三阶段流水线与多层缓存加速架构**：
  1. **单次前端编译与元数据解析（`build-frontend`）**：仅在 `ubuntu-latest` 执行一次 `pnpm install --frozen-lockfile && pnpm build` 并上传 `dist/` Artifact，同时解析 `tag_name` 与 `@tauri-apps/cli` 版本；4 端编译矩阵直接下载 `dist/`，搭配 [`src-tauri/tauri.ci.conf.json`](file:///d:/wade/code/emby-tauri-player/src-tauri/tauri.ci.conf.json)（`beforeBuildCommand: ""`）及官方预编译 `cargo-tauri` 二进制（`tauriScript: 'cargo tauri'`），彻底免除 4 端重复安装 Node/pnpm 与重复编译前端。
  2. **Rust 缓存精细隔离（`swatinem/rust-cache@v2`）**：Release 按 `shared-key: "release-<mpv_platform>-<mpv_arch>-v1"`（`workspaces: './src-tauri -> target'`）独立隔离 `macos-15`（ARM64）与 `macos-15-intel`（x86_64）；`ci.yml` 使用 `ci-check-<platform>-v1` 防止 debug 与 release 缓存互相驱逐。
  3. **`src-tauri/lib/` 整包缓存与强制刷新**：通过 `mpv-bundle-v1-<mpv_platform>-<mpv_arch>-<hash(setup-mpv.mjs)>` 缓存完整动态库产物。macOS 命中后直接跳过 `brew install mpv molten-vk dylibbundler`、`setup-mpv.mjs`、`dylibbundler` 与 `codesign`；**需要主动拉取新版 `libmpv` 或 `libmpv-wrapper` 时，将 `release.yml` 中的 `mpv-bundle-v1` 递增为 `v2` 即可强制冷刷新**。
  4. **冷构建加速与解压零依赖**：[`scripts/setup-mpv.mjs`](file:///d:/wade/code/emby-tauri-player/scripts/setup-mpv.mjs) 优先调用系统原生 `7z` / `unzip` / `tar` 解压，仅在缺失原生工具时动态加载 `7z-wasm`，并支持 `--wrapper-only` 供 macOS CI 跳过重复拷贝；macOS `brew install` 设置 `HOMEBREW_NO_AUTO_UPDATE=1`、`HOMEBREW_NO_INSTALL_CLEANUP=1` 并对 `.dylib` 使用多核并行 `codesign`。
  5. **Linux APT 缓存与桌面端打包精简**：Ubuntu 22.04 接入 `awalsh128/cache-apt-pkgs-action@v1`（`ubuntu22-tauri2-v1`）跨 `ci.yml` 与 `release.yml` 共享系统包缓存；Windows 仅保留 NSIS 并设置 `bundle.windows.nsis.compression: "zlib"` 替代单线程 `lzma` 压缩 101MB `libmpv-2.dll`；Linux 仅保留 `.deb`；[`src-tauri/Cargo.toml`](file:///d:/wade/code/emby-tauri-player/src-tauri/Cargo.toml) 保持桌面端 `crate-type = ["rlib"]`，消除 `staticlib`/`cdylib` 冗余链接。
- **CI 流水线按需手动触发规范**：
  - `.github/workflows/ci.yml` 仅保留 `workflow_dispatch` 手动触发，已关闭 `push` 与 `pull_request` 自动触发，避免日常提交频繁占用 GitHub Actions 运行配额及产生等待延迟；需要云端多平台全量校验时可在 Actions 页面手动触发。

### 9. 桌面端本地文件导出与系统文件管理器/访达联动规范 (Native File Reveal & Local Backup)
- **WebView 下载局限与原生桥接**：
  - 在 Tauri 桌面客户端中，纯前端 `a.click()` 触发 Blob 下载无法准确捕获最终保存物理路径，且无法唤起文件管理器高亮选中目标文件。
  - **解决方案**：通过 Tauri 原生命令 `save_backup_file`，优先调用 `app.path().download_dir()` 定位系统下载目录并安全写入；若遇到同名文件，自动采用 `stem (1).ext` 自增序号避免文件覆盖。
- **跨平台文件管理器唤起与直接打开下载目录 (`open_directory_in_file_manager`)**：
  - **Windows 陷阱与解决**：若调用 `explorer.exe /select,"<Path>"`，因 Windows 底层命令行参数带引号解析问题，会导致 explorer 识别参数失败并**默认降级回退打开“文档”目录**。因此在文件导出下载场景中，直接调用 `Command::new("explorer").arg(&dir_str)`，保证 100% 精准打开真实的系统“下载”目录；
  - **macOS**：调用 `Command::new("open").arg(dir)` 直接打开访达下载目录；
  - **Linux**：调用 `Command::new("xdg-open").arg(dir)` 打开下载目录。
- **UI 反馈与双重操作通道**：
  - 导出成功后提供双层反馈：卡片内呈现带文件名与保存目录的绿色状态面板，页面右上角弹出毛玻璃浮动 Toast；
  - 两处均提供常驻的「打开下载目录」按钮，允许用户随时再次唤起系统文件管理器查看文件。

### 10. 无服务器冷启动下的设置访问与配置恢复规范 (Cold Start Settings & Backup Restoration)
- **冷启动死锁避坑**：
  - 当本地尚未添加任何 Emby 服务器（`servers.length === 0`）时，`HomePage` 会重定向至 `/login` 且侧边栏被隐藏。若无独立入口，用户将彻底无法进入 `/settings`，导致无法通过导入备份或多端同步恢复配置。
- **全链路常驻入口体系**：
  1. **登录页快捷胶囊条**：在 Logo 下方常驻展示「系统设置」、「导入配置」（`navigate('/settings?tab=sync')`）与「网络代理」；
  2. **快速导入恢复卡片**：在登录表单下方配备图文卡片「已有备份或多端配置？支持导入多端同步或备份文件一键恢复」，一键直达恢复向导；
  3. **标题栏与侧边栏兜底**：当 `!currentServer` 时，`TitleBar` 中部展示「设置 & 导入」胶囊按钮；`Sidebar` 底部展示「未连接 · 导入配置」警示卡片，点击自动切至同步 Tab；
  4. **URL 参数深度寻址**：`SettingsPage` 必须支持 `useSearchParams()` 读取 `?tab=sync` 等参数并自动激活对应选项卡；导入完成后直接提供「前往首页进入媒体库」一键直达按钮。

### 11. Tauri v2 HTTP 插件 URL 作用域端口与通配规范 (WHATWG URLPattern Port Whitelisting)
- **默认端口陷阱**：
  - Tauri v2 底层采用 WHATWG URLPattern 解析 HTTP 作用域。当配置为 `http://**` 或 `https://**` 时，仅匹配默认端口（HTTP 80 / HTTPS 443）；
  - 当请求带有任何显式端口号（如弹幕服务 `http://127.0.0.1:9321/...`、Emby 服务 `http://x.x.x.x:8096/...` 或局域网自定义端口）时，会被严格拦截并抛出：`[Tauri HTTP Error] url not allowed on the configured scope`；
- **通配配置要求**：
  - 在 `src-tauri/capabilities/default.json` 的 `http:allow-fetch` 中，必须同时声明不带端口与通配端口的完整 URLPattern：
    `http://*`, `http://*/*`, `http://*/**`, `http://*:*`, `http://*:*/*`, `http://*:*/**`, `http://**`，以及对应完整的 `https://...` 规则。

### 12. libmpv / libmpv-wrapper 打包与 Windows DLL 依赖链加载规范 (Dynamic Library Bundling & Windows DLL Search Path)
- **CI/CD 打包前置依赖注入**：
  - Git 仓库基于体积考虑排除了 `src-tauri/lib/*.dll`, `*.so`, `*.dylib`；因此在 GitHub Actions CI 流水线中，打包动作前必须运行 `scripts/setup-mpv.mjs --platform <platform> --arch <arch>` 自动拉取与目标平台架构严格匹配的 `libmpv-wrapper`（以及 Windows 专属的 `libmpv-2.dll`），避免安装包遗漏内核导致冷启动崩溃；
- **本地开发环境前置检查**：
  - 新克隆仓库、切换机器或拉取代码后发现 `src-tauri/lib/` 只有 `.gitkeep` 时，必须先执行 `pnpm install`、安装平台内核（macOS：`brew install mpv`；Windows/Linux 按 README 指引），再执行 `pnpm setup-mpv`；
  - `pnpm setup-mpv` 在 macOS 找不到 Homebrew `libmpv` 时必须直接失败并提示 `brew install mpv`，不得输出 `SUCCESS` 掩盖缺库；同步动态库后必须重启 `pnpm tauri dev`，否则 Rust 进程不会重新执行 `init_macos_mpv_environment` 的预加载与软链建立；
  - 典型误报：`Failed to load libmpv-wrapper from 'libmpv-wrapper.dylib'` 且搜索路径全部显示 `no such file`，优先检查 `src-tauri/lib/libmpv-wrapper.dylib` 与 `src-tauri/lib/libmpv.dylib` 是否存在且架构匹配（`file` / `otool -L`），不要先怀疑 Bundle 寻址补丁；
  - **禁止同时装载两份同源 `libmpv`**：`ensure_unix_symlink` 若发现目标软链已存在但指向旧路径（如 Homebrew `libmpv`），必须删除并重建为当前资源副本，不能因 `dst.exists()` 直接跳过；开发模式下 `init_macos_mpv_environment(None)` 还必须识别 `current_exe().parent()/lib/`（即 `target/debug/lib`）作为资源目录。否则进程会既预载 Homebrew 原件又由 wrapper 加载项目副本，触发 Objective-C `Class ... is implemented in both ...` 重复类警告甚至崩溃；可通过 `lsof -p <nocta-pid> | grep libmpv` 验证只映射一份。
- **Windows 下 DLL 依赖链加载与 126 错误码修复**：
  - 在 Windows 下，`tauri-plugin-libmpv` 会调用 `LoadLibraryExW` 加载 `libmpv-wrapper.dll`，而该 DLL 的导入表强依赖同目录下的 `libmpv-2.dll`；
  - Windows 系统加载器在解析二级依赖 DLL 时，默认仅检索主程序 `.exe` 所在目录和系统目录，不会自动将子目录 `lib/` 纳入解析链，从而抛出 `LoadLibraryExW code 126 ("找不到指定的模块。")`；
  - **解决方案**：在 Rust 程序入口（`pub fn run()` 及 `app.setup`）中，调用 Win32 API `SetDllDirectoryW` 动态将当前程序的 `lib/`、`resources/lib/` 目录注入为进程级 DLL 优先搜索路径，并同步将其追加到进程环境变量 `PATH` 前端，100% 确保内核与所有二级从属动态库均能顺利装载。

### 13. MPV 原生硬解起播生命周期、异步定点 Seek 与错误回退隔离规范 (MPV Load/Seek Lifecycle & Error Fallback)
- **远端 HTTP / MKV 记忆播放跳转与范围请求强制穿透 (`force-seekable`)**：
  - **全量顺序下载避坑**：当播放挂载在 CloudDrive/Alist/Google Drive 或反代上的 MKV 文件时，若服务端/代理未显式返回 `Accept-Ranges: bytes` 响应头，`mpv` 默认会将流标记为不可寻址（non-seekable）。当带有历史进度起播或定点 Seek 时，`mpv` 会放弃发送 HTTP Range 请求，转而在后台**以全网速（如 15MB/s）从第 0 字节开始顺序读取并丢弃整个前置文件**（例如 4GB 视频起播在第 8 分钟会强制顺序下载前 830MB），表现为「网卡疯狂走流量但播放器持续黑屏死锁」；
  - **解决方案**：在 `MpvPlayerEngine` 初始化及 `load()` 时显式注入：
    - `force-seekable: 'yes'`：强制开启 HTTP Range 范围切片跳转，跳过不可寻址检测直接向服务端请求目标 Cluster 字节区间；
    - `cache: 'yes'` 与 `demuxer-seekable-cache: 'yes'`：激活解复用流级缓存与回退寻址；
    - `demuxer-max-bytes: 419430400`（400MB）与 `demuxer-max-back-bytes: 157286400`（150MB）：保障 4K 60fps 10-bit HDR 高码率流充足预取；
    - `hr-seek-framedrop: 'yes'`：高精跳转时丢弃中间非关键帧，避免 4K 60fps HEVC 解码器因解码大量中间帧造成显卡拥塞黑屏；
    - `demuxer-mkv-subtitle-preroll: 'no'`：严禁 MKV 内嵌/外挂字幕（如 SUBRIP/ASS）跨网络流反向倒灌探测，彻底消除寻道拖垮。
- **严禁在 `loadfile` 后同步调用 `command('seek')`**：
  - `libmpv` 的 `command('loadfile', [url])` 是异步入队指令，函数返回时网络流尚未打开（`file-loaded` 尚未触发）。若在 `initialTime > 0`（有历史观看进度）时紧接着调用 `await command('seek', [initialTime, 'absolute'])`，`libmpv` 会直接拒绝并抛出 `mpv command failed: error running command`；
  - **正确做法**：在 `loadfile` 前通过 `await setProperty('start', '+' + Math.floor(initialTime))` 预设起播时间点，且初始记录 `this._currentTime = 0`（严禁在起播前假赋值为 `initialTime` 导致兜底逻辑被短路）；在监听到 `file-loaded` 事件（文件头就绪）后安全执行带独立 `try/catch` 的 `command('seek', [targetSeek, 'absolute'])` 绝对寻址；在监听到 `playback-restart` 事件（解码真正就绪）后再重置 `start='none'`。
- **加载遮罩与黑屏穿透防护**：
  - 在 `PlayerPage` 中，若 `initialTimeRef.current > 0`，在 `hasInitialSeekedRef.current` 达成且收到首个有效解码秒数（`cur >= 1`）前，即使收到内核 `state='playing'` 也禁止过早解除 `isLoadingVideo`，彻底杜绝底层尚未出帧时的黑色底板穿透。
- **全局串行生命周期队列 (`MpvPlayerEngine.lifecycleQueue`)**：
  - `tauri-plugin-libmpv` 按窗口标签 `'main'` 维护单例。跨页面快速进出播放页时，前一个引擎实例的异步 `destroy()` 与新实例的 `init()` 可能并发冲突。必须通过静态 Promise 队列串行化 `init` 与 `destroy`，并在实例内用 `initPromise` 合并并发的初始化请求。
- **区分引擎的流回退策略与陈旧闭包防护**：
  - `PlayerPage` 注册 `engine.onError` 时必须使用 `handleVideoErrorRef` 与 `fallbackLevelRef` 获取实时状态，防止因 React 首次挂载闭包陈旧导致 `fallbackLevel` 永远停留在 `0` 而死锁在黑屏加载层；
  - `MPV` 原生硬解支持全格式直连（`static=true`），回退时**必须跳过专为 HTML5 `<video>` 设计的 Level 1（`MP4 轻量重封装`）**，避免在禁用转码或 302 直链的 Emby 服上因重封装失败而黑屏。
- **容器后缀规范化与局域网代理旁路**：
  - `buildNativeDirectStreamUrl` 必须规范化 `mediaSource.Container`（例如将 `mov,mp4,m4a,3gp,3g2,mj2` 取首项 `mov`，将 `matroska,webm` 映射为 `mkv`）；
  - 当目标流 URL 为局域网或回环地址（`192.168.x.x`、`10.x.x.x`、`172.16-31.x.x`、`localhost`、`127.0.0.1`）时，`MpvPlayerEngine` 自动将 `http-proxy` 置空直连，防止局域网 NAS 视频流被系统代理截留或因非 HTTP 代理协议报错。

### 14. 100% 直连原画与零服务端转码约束 (Zero Server Transcoding & Direct Play Only Policy)
- **坚决禁止隐式转码与重封装**：
  - 客户端所有播放流请求必须且只能使用 `static=true` 原始直出，**严禁向 Emby 服务端请求任何实时转码参数（如 `VideoCodec=h264&AudioCodec=aac`）或实时 MP4 重封装（`VideoCodec=copy`）**；
  - 杜绝因播放器兼容性差而霸占或打满 NAS / VPS 服务端 CPU 与显卡算力；
- **HTML5 播放内核遇不支持格式直接报错引导**：
  - HTML5 引擎仅作为基础原画兼容（仅直接播放 MP4/H.264 等浏览器原生支持的原始文件）；
  - 当遇到 MKV、HEVC、AV1、DTS 等浏览器无法直接硬件解码的格式时，**绝不回退到服务端转码**，直接提示：*“当前片源格式浏览器内核无法直接解码，已严格阻止服务端转码。请使用 MPV 原生硬解引擎播放原画。”*；
  - 并在错误遮罩中提供「一键切换至 MPV 硬解」行动按钮，方便用户一键无缝恢复播放。

### 15. 播放器实时网络速度测量与 OSD 状态联动规范 (Real-Time Network Speed Monitoring & OSD Integration)
- **测量数据源与平滑采集机制**：
  - `libmpv` 原生硬解：通过 `observeProperties` 监听 `cache-speed`（`int64`）与 `demuxer-cache-state`（`node`），提取网络输入速率（字节/秒）；配合纯 JS 定时器（**严禁调用 `getProperty(..., 'node')`**）在超过 2.5 秒无新速率事件或闲置时自动平滑归零；
  - `HTML5` 引擎：在 `video` 原生加载周期中以 1 秒为基准采样 `video.buffered` 增量估算瞬时网络下载速率；
- **OSD 同步显隐与非侵入视觉呈现**：
  - 用户体验要求实时网速必须跟随进度条一起隐藏和显示；因此将网速微标布局在底部控制栏左侧时间显示（`currentTime / duration`）右侧，天然受 `PlayerOsd` 的 `isOsdVisible` 统一控制（3.5 秒闲置淡出，鼠标移动即时淡入）；
  - 采用轻量格式化工具 `formatNetworkSpeed`（支持 `0 KB/s`、`KB/s`、`MB/s`，保留一位小数），配备微脉冲下载动效与等宽字体（`font-mono`）；
  - 详细播放信息面板（HUD 浮层）同步呈现当前实时下载速率，并在「一键复制信息」纯文本中导出。

### 16. `libmpv-wrapper` 内存安全红线与 macOS 自包含动态库打包规范 (FFI Memory Safety & macOS Self-Contained Dylib Bundling)
- **严禁调用 `getProperty(..., 'node')`（致命栈溢出红线）**：
  - `nini22P/libmpv-wrapper` 的 `get_property_node` 在栈上仅声明了 8 字节指针（`let mut data: *mut mpv_node = null_mut()`），而 `libmpv` C API 的 `mpv_get_property(..., MPV_FORMAT_NODE, &mut data)` 会直接向 `&mut data` 写入 **16 字节** 的 `struct mpv_node` 结构体，随后 `defer!` 又将损坏的结构体首字段当作指针传入 `mpv_free_node_contents`；
  - 一旦在前端调用 `getProperty('demuxer-cache-state', 'node')`（或任何 `'node'` 类型的 `getProperty`），会导致 100% 必现的栈缓冲区溢出与非法内存访问崩溃（Windows 弹窗报错 `nocta has stopped working / Error launching CrashSender.exe`）；
  - **正确做法**：所有复杂属性或数值属性统一通过 `observeProperties` 事件回调获取（`events.rs` 中 `mpv_event_property.data` 为真实指针且无非法释放），**绝不调用 `getProperty(..., 'node')`**。
- **规避 `tauri-plugin-libmpv` 的 `destroy()` Use-After-Free 崩溃**：
  - `tauri-plugin-libmpv` 在 `destroy()` 时调用 `mpv_wrapper_destroy` 后立即执行 `Box::from_raw(instance.event_userdata)` 释放内存，而此时 `libmpv-wrapper` 的后台 `event-client` 线程仍在并发回调 `event_callback(Event::Shutdown)` 读取 `event_userdata`；
  - **解决方案**：`'main'` 窗口的 `mpv` 实例一经创建即作为进程级持久单例复用（`MpvPlayerEngine.mpvInstanceCreated = true`）；退出播放页调用 `MpvPlayerEngine.destroy()` 时，仅解绑前端事件监听并执行 `setProperty('pause', true)` + `command('stop')` 使内核进入 0 占用的 `idle` 状态，不调用插件的 `destroy()`。
- **macOS 自包含 `libmpv.dylib` + `MoltenVK` 打包与运行时软链规范**：
  - `libmpv-wrapper` 在 macOS 下首先查找 `current_exe().parent().join("libmpv.dylib")`（即 `Nocta.app/Contents/MacOS/libmpv.dylib`），随后回退调用 `dlopen("libmpv.dylib")`（在 GUI 应用中仅搜索 `$HOME/lib:/usr/local/lib:/usr/lib`，**不会搜索 `/opt/homebrew/lib`**），若找不到则直接返回 `NULL` 并报错 `Failed to create mpv instance`；
  - **CI 打包规范与 Homebrew 只读权限避坑**：
    - Homebrew 安装在 Cellar 中的动态库文件权限默认为只读（`0444`/`0555`）。通过 `setup-mpv.mjs` 复制或 shell 脚本重复覆盖时，BSD/macOS 的 `cp` 会直接报 `cp: src-tauri/lib/libmpv.dylib: Permission denied` 导致 CI 构建中断；
    - **解决方案**：在 `setup-mpv.mjs` 复制完后立即 `chmodSync(dest, 0o755)`；在 CI 工作流执行打包前显式注入 `chmod -R u+w src-tauri/lib/ 2>/dev/null || true` 并使用 `rm -f` + `cp -fL`，彻底杜绝权限不足；
    - macOS Apple Silicon (`macos-15`) 与 Intel (`macos-15-intel`) 分别在原生架构 Runner 上通过 `dylibbundler` 将 `libmpv.dylib` 及其全部非系统依赖动态库、连同 `libMoltenVK.dylib` 与 `MoltenVK_icd.json` 一并打包进 `src-tauri/lib/`，重写 `@loader_path/` 并对所有 `.dylib` 执行 `codesign --force --sign -` 重签名；
  - **macOS Bundle 架构下 `tauri-plugin-libmpv` 原生动态库寻址穿透与 dlopen 预热**：
    - **上游插件硬编码路径缺陷**：`tauri-plugin-libmpv` 原版 `desktop.rs` 仅检查 `current_exe().parent()` (`Contents/MacOS`) 与 `exe_dir.join("lib")` (`Contents/MacOS/lib`)。在 macOS Bundle 体系中，Tauri 的 `"resources": ["lib/**/*"]` 必然打入 `Contents/Resources/lib/`。若在只读 DMG（`EROFS`）或签名后的 `/Applications` 运行时，动态在 `Contents/MacOS` 建立软链会失败，导致 `valid_lib_path` 退化为裸文件名 `"libmpv-wrapper.dylib"`，继而触发 dyld 报错：`dlopen(libmpv-wrapper.dylib, 0x0005): tried: 'libmpv-wrapper.dylib' (no such file)...`；
    - **解决方案 1（插件原生路径补丁）**：通过 Cargo `[patch.crates-io]` 本地重写 `src-tauri/crates/tauri-plugin-libmpv`，在 `search_dirs` 中显式扩展 `contents_dir.join("Resources").join("lib")`、`contents_dir.join("Resources")`、`contents_dir.join("Frameworks")` 及 `self.app.path().resource_dir()`，确保绝对路径 100% 精准寻址；
    - **解决方案 2（Rust 进程全局预热 Pre-loading）**：在 `init_macos_mpv_environment` 中，使用 `libc::dlopen(..., RTLD_NOW | RTLD_GLOBAL)` 先行预热加载 `libmpv-wrapper.dylib` 与 `libmpv.dylib`，将动态库镜像常驻进程内存，使后续任何裸库名 dlopen 均能瞬间命中内存缓存。
  - **macOS 播放窗口必须嵌入 Nocta 主窗口（禁止独立 mpv 窗口体验）**：
    - mpv 官方 `--wid` 仅支持 X11、Win32、Android，macOS 的 `CocoaCB` 会忽略 `wid` 并自行创建 `NSWindow`；不能通过插件传入 NSView 指针实现嵌入；
    - 当前方案：mpv 启动参数使用固定标题 `Nocta Video Surface`、`border=no`、`title-bar=no`、`auto-window-resize=no`、`focus-on=never`、`input-cursor-passthrough=yes`；前端在 `file-loaded` / `playback-restart` 后调用 `attach_mpv_window`；
    - Rust 侧 `src-tauri/src/mpv_embed_macos.m` 在主线程枚举 `NSApp.windows`，找到固定标题窗口后设置为无边框、透明背景、忽略鼠标事件、`FullScreenAuxiliary`，并通过 `addChildWindow:ordered:NSWindowBelow` 放在 Nocta 主窗口下方；WebView 保持上层，弹幕、OSD 和控制栏继续由 React 渲染；
    - `NSWindow` / AppKit 操作必须经 `window.run_on_main_thread(...)`，绝不能在 Tauri IPC 线程直接调用；离开播放页时调用 `detach_mpv_window` 将子窗口移除并 `orderOut`；
    - 选项名避坑：mpv 实际选项为 `input-cursor-passthrough`，写成 `cursor-passthrough` 会使 `mpv_set_option_string` 返回错误，导致内核初始化失败。
    - **macOS 全屏使用原生 `setFullscreen`**：`setSimpleFullscreen` 本质仍是铺满屏幕的普通窗口，会被用户感知为“只是最大化”，且 Tauri 会吞掉底层失败返回值。进入原生全屏后必须依靠 `mpv_embed_macos.m` 的 `NSWindowDidEnterFullScreenNotification` / `NSWindowDidExitFullScreenNotification` / `NSWindowDidChangeScreenNotification` 监听，在事件后同步子窗口 frame 并执行 `orderWindow:NSWindowBelow relativeTo:`，重新把 mpv 压回 WebView 下方；200ms 同步定时器也要持续校正层级。

### 17. macOS 原生交通灯与标题栏 Overlay 规范 (Native Traffic Lights & Overlay Title Bar)
- **禁止在 macOS 用 CSS 模拟交通灯**：12px 圆点经过 WebView 合成必然存在模糊与语义偏差（绿色按钮无法正确进入原生全屏）。macOS 必须使用 AppKit 原生交通灯。
- 通过 `src-tauri/tauri.macos.conf.json` 做平台覆盖：`decorations: true`、`titleBarStyle: "Overlay"`、`trafficLightPosition: { x: 16, y: 18 }`、`hiddenTitle: true`；主 `tauri.conf.json` 保持 `decorations: false`，供 Windows/Linux 使用自定义右侧窗口按钮。
- 原生交通灯覆盖在 48px 自定义标题栏左上角，`TitleBar` 保留 `pl-20` 让位，但不得再渲染红黄绿 CSS 按钮；标题栏自身仍使用 `data-tauri-drag-region`。播放页的 `PlayerOsd` 在 macOS 非全屏时使用 `pl-20` 避让原生交通灯，全屏时恢复 `pl-5`。
- 全屏入口统一调用原生 `setFullscreen`，绿色交通灯、OSD 全屏按钮、`F` 与 `Escape` 必须使用同一状态来源 `isFullscreen()`；“最大化”只能是独立操作，禁止再用“窗口全屏”文案混淆。

### 18. macOS 原生全屏 OSD 独立浮层规范 (Fullscreen OSD Overlay Window)
- **根因认知**：进入 macOS 原生全屏 Space 后，mpv 的 `FullScreenAuxiliary` 子窗口会被系统抬到主窗口之上，WebView 内渲染的 OSD、弹幕与进度条被视频画面遮挡。这不是 CSS `z-index` 问题，`orderWindow:NSWindowBelow` 与 200ms 层级校正也无法穿透全屏合成器；因此不要在全屏时继续单窗口渲染 OSD。
- **方案**：仅当 `macOS + engineType === 'mpv' + 原生全屏` 时，由 `PlayerPage` 调用 `open_osd_overlay` 创建第二个 Tauri 窗口 `osd-overlay`（`index.html?osd=1`），透明、无边框、`always_on_top`，并在主线程配置 `NSStatusWindowLevel` + `NSWindowCollectionBehaviorFullScreenAuxiliary`，承载 `PlayerOsd` 与 `DanmakuLayer`；主窗口同时隐藏自身 OSD 与弹幕，退出全屏或离开播放页立即 `close_osd_overlay`。
- **状态同步协议**（`src/player/osdOverlaySync.ts`）：主窗口每 200ms 广播 `osd:sync`（播放进度、音量、倍速、网速、音字幕轨、弹幕设置等），弹幕列表变化时广播 `osd:comments`，浮层挂载后发 `osd:ready`，浮层操作通过 `osd:command` 回传主窗口统一执行。禁止在浮层里直接操作引擎或 Emby API。
- **浮层交互**：浮层是 key window，必须自行接管全部播放器快捷键与鼠标手势（含 `Space / ← → / ↑ ↓ / D / F / ? / I / N / P / Esc` 分层退出）。`PlayerOsd` 在 `overlayMode` 下**保留全部功能控件**（弹幕抽屉、弹幕开关、画质调校、分集、多版本切换、播放信息、代理浮层与退出全屏还原按钮），仅禁掉原生窗口拖拽区/双击最大化及非全屏专属的 Pin/Min/Close 按钮；主窗口与全屏浮层共享一致的悬浮进度条、右击菜单（全屏下隐藏无意义的窗口置顶项）及弹幕开关 HUD 反馈。OSD 隐藏时顶部胶囊必须同步 `pointer-events-none`，否则不可见区域会吞掉视频点击。
- **窗口生命周期**：`WebviewUrl::App("index.html?osd=1")` 由 Tauri 通过 `Url::join` 解析；创建后、`show()` 后都要重新应用原生 level/collectionBehavior，防止显示时排序被重置。React StrictMode 会并发触发创建，Rust 侧遇到 `label already exists` 必须视为成功返回。
- **平台隔离红线**：该浮层只允许 macOS + mpv 引擎启用；Windows/Linux 的 `--wid` 嵌入与 HTML5 引擎必须保持原单窗口渲染路径，禁止无条件调用 `open_osd_overlay`。

### 19. 片头片尾标记与自动跳过规范 (Intro/Outro Skip Segments)
- **数据模型与共享粒度**：
  - `SkipSegments` 仅存储 `introEnd`（片头结束秒数）、`outroStart`（片尾开始秒数）与 `updatedAt`；不要存“片头开始”，起播永远从 0 或用户记忆进度开始判断；
  - `getSkipKey(item)` 对带 `SeriesId` 的剧集统一使用 `series_<SeriesId>`（标一集全剧生效），电影/无剧集条目使用 `item_<Id>`；跨集继承时必须额外校验 `introEnd < runtime - 5`、`outroStart < runtime - 2`，避免不同时长剧集误触发；
- **起播自动跳片头**：
  - 必须在 `PlayerPage` 内、`engine.load()` 前把记忆进度解析为 effective initial time；满足 `skipIntroEnabled && rawTime < introEnd - 1` 时以 `introEnd` 作为 `initialTime` 传给引擎；
  - MPV 与 HTML5 引擎都复用既有 `initialTime` 链路（MPV 的 `start` 预设、HTML5 的首帧 seek），禁止在 `loadfile` 后同步追加 `seek`；`initialTimeRef` 必须更新为实际起播秒数，继续参与首跳黑屏防护；
- **片尾轻提示与取消**：
  - 检测点放在引擎无关的 `onTimeUpdate`，用 `usePlayerStore.getState()` 读取最新标记与设置，禁止依赖首次挂载闭包；每次播放/每次切换条目仅触发一次 `outroToastShownRef`；
  - 8 秒倒计时由主窗口统一维护，`cancel` 设置 `outroDismissedRef`（本次会话不再提示），`skip` 执行 `seek(total - 0.25)` 让播放器自然派发 ended；默认行为为 `ask`（倒计时结束仅关闭提示），可选 `auto`；
  - 片尾提示独立于 OSD 显隐渲染（`z-40`），即使进度条因鼠标闲置淡出也必须保持可见；
- **OSD 标记面板**：
  - 控制栏使用 `Crosshair` 标记入口（与下一集 `SkipForward` 区分），面板提供“标记片头结束/片尾开始”、点击已标记时间跳转校验与清除操作；标记必须校验 `seconds >= 1`、片头不超过片长 95%、片头结束早于片尾开始、片尾开始晚于片头结束且早于结尾 2 秒；
- **macOS 全屏浮层同步**：
  - `osd:sync` 载荷必须携带 `skipSegments / outroToast{visible,remainingMs,totalMs} / skipOutroAction / skipNotice`；浮层渲染同一套标记面板、片尾 Toast 与操作提示；
  - 浮层的标记、清除、跳过、取消全部通过 `osd:command` 回传主窗口执行，禁止浮层直接写 store 或操作引擎；
- **持久化与多端同步**：
  - localStorage 使用 `nocta_skip_segments` / `nocta_skip_settings`；备份与多端合并时按 `updatedAt` 取新者，导入旧版本备份必须容忍字段缺失并保留本机已有数据（replace 模式除外）；
  - 设置页提供“自动跳过片头 / 片尾跳过提示 / 倒计时结束仅提示或自动跳过”三项，默认全部开启且采用 `ask`，避免错过片尾彩蛋。

### 20. 播放器沉浸体验、零闪烁弹幕与透明代理热切规范 (Player UX, Zero-Flicker Danmaku & Live Proxy Switching)
- **严禁因视觉参数变更触发 `DanmakuLayer` 重建 Canvas（消除闪烁红线）**：
  - `DanmakuLayer` 监听 `[bridge, comments]` 引用重建实例。因此 `PlayerPage` 构造 `formattedComments` 的 `useMemo` **只能依赖实际改变弹幕内容的字段**（`rawComments`, `fontSize`, `fontWeight`, `strokeWidth`, `colorMode`, `blockScroll`, `blockTop`, `blockBottom`, `blockColor`, `blockedWords`, `mergeDuplicates`）；
  - **绝不能将 `visible` / `opacity` / `speed` / `area` / `maxLines` / `bottomMargin` / `showHeatmap` 放入 `useMemo` 依赖**，否则拖动滑块调参时会造成满屏弹幕销毁重绘闪烁。
- **进度条拖拽防抖与防进度丢失（Scrub Debounce & Session Progress Safety）**：
  - `PlayerOsd` 的进度条 `<input type="range">` 拖动过程中只更新本地 `scrubTime`（借助 `isScrubbingRef` + `scrubTimeRef`），仅在 `onPointerUp` / `onTouchEnd` / `onKeyUp` 释放时才调用 `onSeek`；
  - 在播放页内原地切集或切换多版本片源时，必须先用 `lastValidTimeRef.current` 上报当前会话的 `reportPlaybackStopped` 并记录 `reportedStoppedSessionRef`，防止 `useEffect` 清理函数在引擎 `load()` 重置 `_currentTime = 0` 后误将 Emby 播放进度冲刷归零。
- **无边框播放窗顶部拖拽区交互规范**：
  - `PlayerOsd` 顶部栏外层必须使用在 `visible` 状态下具备 `pointer-events-auto` 与 `data-tauri-drag-region`（`overlayMode` 下禁用）的有限高度容器，两侧毛玻璃胶囊内部通过 `stopPropagation` 防止事件干扰，才可确保无边框窗口态可平滑拖拽与双击最大化。
- **`libmpv` 真实硬解遥测与透明 `socks5` 路由提示**：
  - 真实硬解状态 (`hwdec-current`)、帧率 (`estimated-vf-fps`)、丢帧数 (`frame-drop-count`)、前向缓冲 (`demuxer-cache-duration`, `demuxer-cache-time`, `fw-bytes`) 全部通过 `OBSERVED_PROPERTIES` + 节流事件推送获取，延续「绝不调用 `getProperty(..., 'node')`」红线；
  - `resolveMpvProxyDetailed` 明确区分系统 HTTP 代理、手动 HTTP 代理、局域网直通旁路、直连以及 `socks5_fallback_direct`——当用户配置 `socks5://` 时透明展示说明并引导使用混合端口，同时支持通过 `StreamProxyOverride`（`follow` / `direct` / `proxy`）在不退出播放页的前提下原地保留精确秒数热重连媒体流。
- **快捷键无打扰 Mini HUD 规范**：
  - 键盘调音量、快进/快退（支持 800ms 内连按累加显示）、倍速、长按 `→` 临时 2.5x 倍速快进（注意忽略 `e.repeat` 并处理 `blur` 恢复）、弹幕/字幕偏移均只呼出 `MiniActionHud` 轻量反馈胶囊，绝不拉起完整上下 OSD 工具栏，最大化沉浸观影体验。

### 21. 播放器模块解耦、并发竞态防护与 CI 打包红线 (Architecture Refactoring & Guardrails)
- **CI 必须直编 `danmaku` 源码 (`vite.config.ts`)**：
  - `node_modules/danmaku`（`github:wade6716/Danmaku`）更新了 `src/index.js`（新增 `area` / `opacity` / `maxLines` / `bottomMargin` / `offset`）但未重建 `dist/esm/danmaku.js`。因此 `vite.config.ts` 必须做两级源码解析：优先 `../Danmaku/src/index.js`，不存在时回退至 `node_modules/danmaku/src/index.js` 并将其保留在 `optimizeDeps.exclude`，严禁 CI 打包机静默退回到旧版 `dist/` 导致发布包弹幕布局配置失效。
- **高频时钟与 Store 持久化分层**：
  - `PlayerPage` 收到引擎 `onTimeUpdate` 后，对 `MpvDanmakuBridge.onMpvTimePos` 与片尾起点检测保持不节流实时直通，对写入 Zustand `updateTime` 保持 **250ms 节流**（Seek 或时长变更立即穿透）；各抽屉、面板与 `PlayerPage` 一律使用精细化 Selector 按字段订阅状态，非开启状态的面板按需条件渲染（`DanmakuDrawer` 保留实例但将 `currentTime` 量化至 5 秒分桶）；
  - `usePlayerStore` 的高频滑块持久化统一走 `saveStorageDebounced`（200ms 合并写入 + `beforeunload` 刷盘），且 `setPlaybackContext` 必须通过 `get().playerPreferences` 读取内存最新偏好，禁止直接重读 `localStorage` 造成未刷盘偏好丢失。
- **异步切集与弹幕匹配并发竞态锁**：
  - `useDanmakuSession`（`danmakuReqIdRef` + `activeItemIdRef`）与 `switchToEpisode`（`episodeSwitchReqIdRef`）在每个 `await` 后均校验请求令牌是否仍是最新且属于当前条目，防止快速连点切集时慢响应倒灌覆盖新剧集；
  - 统一通过 `src/player/playbackSessionService.ts` 装配零转码直连流地址与音字幕轨道，`DetailPage` 与 `PlayerPage` 共享同一套起播服务，正交业务拆入 `src/player/hooks/` 四个领域 Hooks。
- **macOS 全屏浮层协议与快捷键对齐**：
  - `OsdSyncPayload` / `OsdCommand` 与 `OsdOverlayPage` 完整同步画质徽标、硬解遥测、代理路由、章节、高能弹幕热力图、A-B 循环及 `MiniActionHud`，并接入全部快捷键（含 200% MPV 音量增益、长按 `→` 倍速、滚轮手势）。

### 22. macOS 全屏浮层完全对等同步与详情分集卡片可读性规范
- **双 WebView 状态双向防环同步（Store Bridge Pattern）**：
  - macOS 全屏下 `OsdOverlayPage`（独立窗口 `osd-overlay`）与主窗口 `PlayerPage` 各自拥有独立的 Zustand 内存实例与 `localStorage` 句柄。凡是来自主窗口同步的状态，浮层侧必须通过 `usePlayerStore.applyRemoteStoreSnapshot(patch, false)` 与 `useDanmuStore.syncServersFromRemote(..., false)` 仅更新内存状态、禁止重复写盘；而用户在浮层面板主动修改设置时，通过 `OsdCommand` 回传主窗口执行 `applyRemoteStoreSnapshot(patch, true)` 统一落盘，防止双端相互覆盖或持久化竞态。
  - **防环回写锁**：主窗口维护 `storeRevisionRef` 与 `applyingOverlayPatchRef`，浮层维护 `lastStoreRevisionRef` 与 `applyingRemoteStoreRef`；仅当远端 Revision 递增且本地未处于回放补丁阶段时才应用快照，彻底避免双向同步引发事件风暴死循环。
- **高频 60fps UI 与原始弹幕零延迟同步**：
  - 浮层内的 `DanmakuDrawer`、`VideoProPanel`、`EpisodeDrawer`、`NetworkProxyPopover`、`PlaybackInfoModal`、`ShortcutsModal`、`NetworkProxyModal` 全部 7 个抽屉/弹窗与主窗口保持 100% 一致；高帧率滑块直接读取本窗口 Zustand 状态获得 60fps 跟手响应。
  - `OSD_OVERLAY_RAW_COMMENTS_EVENT` 独立传输当前匹配到的原始弹幕数组，避免在 200ms 常规心跳中反复序列化大数组；同时 `useMacOsdOverlaySync` 提供 `instantSyncKey` 触发器，切换开关、章节、面板状态时 0 延迟即时同步。
- **浮层交互护栏与快捷键分层退出**：
  - 任何面板打开时（`isAnyPanelOpen`），必须冻结 OSD 自动隐藏计时器并暂停视频区滚轮手势（防止调节弹幕列表或画质滑块滚动时误触音量/进度）；视频单击切换播放需保留 240ms 防抖以区分双击全屏还原；`Escape` 遵循「最上层弹窗 -> 侧滑抽屉 -> 右键菜单 -> 退出全屏」严格层级依次收起。
- **弹幕控制行为全模式统一**：
  - 无论处于窗口态还是 macOS 原生全屏态，点击底部/顶部弹幕开关图标统一执行 `handleToggleDanmakuWithHud` 并展示 `MiniActionHud` 状态提示，点击顶部右侧弹幕数胶囊或底部「弹幕」按钮统一打开弹幕抽屉。
- **分集卡片空间分配与长文本可读性规范**：
  - `EpisodeGrid` 严禁在多列（`xl:grid-cols-4`）下使用左侧固定宽度缩略图 + 右侧窄列文本的横向挤占排版；必须采用「上方 `w-full aspect-video` 宽屏剧照 + 下方全宽标题与最多 3 行高对比度简介（`text-xs text-slate-300/95`）」的影院级竖向卡片布局，确保窄屏与宽屏下分集编号、标题及简介均完整清晰可读。
  - 详情页主简介及播放器分集抽屉同步保持清晰行高（`leading-7`）与「展开全部 / 收起简介」长文展开能力。
- **视频文件体积展示与 `.strm` 空体积兼容规范**：
  - 全应用统一复用 [`embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts) 导出的 `formatFileSize`（支持 `TB`/`GB`/`MB`/`KB`）与 `getItemFileSize`（优先读取首个有效正值 `MediaSources[].Size`，缺失时回退 `item.Size`）。
  - 遇到 `.strm` 远程流或未扫描入库的条目时，`Size` 可能为 `undefined` 或 `0`；严格仅在存在有限正数体积时渲染体积徽标，杜绝出现 `0 MB` 或空白占位符。
  - 详情页在剧集（`Series`）视图下按当前选中季已拉取的分集汇总总体积（`本季`/`共`），切换非剧集条目时须及时清空残留季/集状态；多版本片源主标签附带版本数量并在 `title` 中逐行列出各版本封装与体积。
- **弹幕源分集标题结构化解析与选集交互规范**：
  - `danmu_api` 返回的分集标题常带有 `【bilibili1】`、`[qq]` 等平台来源前缀（如 `【bilibili1】第188集`），若直接显示或使用朴素正则 `/(\d+)/` 提取集号，会导致窄列按钮截断只剩 `【bilibili1...` 且同剧延续匹配会把 `bilibili1` 里的 `1` 误认作第 1 集。
  - 统一通过 [`danmuClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/danmuClient.ts) 导出的 `parseDanmuEpisodeInfo` 循环剥离平台来源前缀（**严禁**误剥 `SP`/`OVA`/`OAD`/`PV`/`OP`/`ED` 等番外标记）并提取 `platform`、`episodeNumber`、`shortLabel`、`badgeLabel` 与 `subTitle`；[`useDanmakuSession.ts`](file:///d:/wade/code/emby-tauri-player/src/player/hooks/useDanmakuSession.ts) 的同剧延续匹配亦须复用该解析器。
  - [`DanmakuDrawer.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/player/DanmakuDrawer.tsx) 在主平台前缀一致时将该标识提升至头部去重胶囊，超 50 集长番剧自动按每 50 集分段并提供全集筛选、当前播放集一键定位，以及「纯数字网格 / 含副标题列表」自适应视图。选定番剧加载完分集后，优先依据当前播放集号（`IndexNumber` 缺失时从标题 `S01E188`/`第188集`/`EP188` 推导兜底）匹配目标分集，先自动切页再用容器级双 `requestAnimationFrame` + `container.scrollTo({ behavior: 'smooth' })` 将目标按钮与分段标签平滑居中（严禁调用 `Element.scrollIntoView()` 以免外层抽屉跳动）；点击分集拉取绑定期间须使用独立的 `bindingEpisodeId` 局部加载态，严禁复用 `loadingEpisodes` 卸载分集列表导致滚动位置归零。
- **独立「继续观看」跨服列表页与「仅首页切换 Emby 服务器」约束**：
  - 「继续观看与最近播放」已从首页抽离为独立页面 [`ContinueWatchingPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/ContinueWatchingPage.tsx)（路由 `/continue-watching`），底层通过 [`embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts) 导出的 `getFederatedPlaybackHistory` 并发拉取全部已配置 Emby 服务器的断点与最近播放记录，单服内严格经 `isVideoMedia` 过滤非视频并以 `mergeMediaBySeries` 合并同剧集多集，跨服按最近播放与未完播优先级排序、注入 `ServerId`/`ServerName`/`ServerUrl`，支持按服务器、观看状态与关键词筛选及列表内一键跨服直链续播（点击跨服卡片时遵循第 5 节先对齐 `setCurrentServer` 与 `clearMediaCache`）。
  - **仅允许在首页（`/`）手动切换当前 Emby 服务器**：[`TitleBar.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/layout/TitleBar.tsx) 仅在 `location.pathname === '/'` 时渲染可展开的 `ServerSwitcherDropdown`，非首页展示只读当前服务器状态胶囊；[`EmbyServerModal.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/settings/EmbyServerModal.tsx) 仅在首页渲染切换按钮；[`SettingsPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/SettingsPage.tsx) 仅负责服务器配置增删改查，不提供切换动作。
  - **切换后强制回首页重拉与防竞态**：[`useAuthStore.ts`](file:///d:/wade/code/emby-tauri-player/src/stores/useAuthStore.ts) 的 `setCurrentServer` 必须返回不可变排序数组；[`useMediaStore.ts`](file:///d:/wade/code/emby-tauri-player/src/stores/useMediaStore.ts) 的 `clearMediaCache` 自增 `cacheVersion`；切换入口统一清空缓存、将 `#main-scroll-container` 滚回顶部并 `navigate('/', { replace: true })`；[`HomePage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/HomePage.tsx) 借助 `cacheVersion` 与 `loadReqIdRef` 丢弃旧服慢响应，确保切服后媒体库、视图统计与 Hero Spotlight 100% 刷新为目标服务器数据。

### 23. 内存按时长缓冲（默认 5 分钟）与纯内存下一集智能预加载规范 (In-Memory Duration Buffering & Preloading)
- **时长与 `libmpv` 解复用双限协同避坑**：
  - `libmpv` 同时受 `demuxer-readahead-secs` 与 `demuxer-max-bytes` **先到达者**截断。若只加大字节上限而不放宽 `demuxer-readahead-secs`（原硬编码 `60s`），低码率流永远无法缓满 5 分钟；反之只设时长而不设 `cacheMemoryCapMB` 上限，高码率 4K 原盘（60~80 Mbps）会瞬间占用 2~3 GB 内存导致 OOM。
  - [`MpvPlayerEngine.ts`](file:///d:/wade/code/emby-tauri-player/src/player/MpvPlayerEngine.ts) 实现 `setBufferConfig({ bufferDurationSeconds, mediaBitrateBps, cacheMemoryCapMB })`，默认按 **5 分钟（300 秒）** 结合真实码率（`1.25x` 余量，缺失时按 16 Mbps 兜底）实时下发 `demuxer-readahead-secs`、`demuxer-max-bytes`（`clamp(est, 128 MiB, cacheMemoryCapMB)`）与 `demuxer-max-back-bytes`（25% 占比、`64~256 MiB`）；全配置通过 [`usePlayerStore.ts`](file:///d:/wade/code/emby-tauri-player/src/stores/usePlayerStore.ts) `normalizePlayerPreferences` 统一钳制校验（安全上限支持 `256M / 512M / 1G / 1.5G / 2G`，默认 `1G`）。
- **纯内存分块预加载（零磁盘 IO）与片头跳过字节区间规划 ([`preload.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/preload.rs))**：
  - 严禁向磁盘写临时文件或分配超大单一连续 `Vec<u8>`（防扩容 realloc 抖动与清理遗漏），统一采用 **1 MiB 分块区间存储（`ExtentStore` / `MemExtent`）**，销毁或释放时 `clear_and_shrink()` 立刻归还 OS 内存；**绝对禁止在持有 `RwLock` 时跨越 `.await`**，避免并发 Socket 读流死锁或中毒。
  - 探测上游文件总大小必须使用 `GET Range: bytes=0-0`（兼容 Alist/CloudDrive 等对 `HEAD` 支持较弱的网关），启用自签证书容忍与代理复用（播放 `127.0.0.1` 本地代理流时 `libmpv` 直连不走外部代理，同时保留 `upstreamUrl` 让前端代理状态诊断保持真实）；若跳过片头（`startSec > 5`），按 `头部 4 MiB` + `尾部 4 MiB`（MKV Cues / MP4 moov 关键索引） + `线性时间估算偏移 - 12s VBR 余量` 起正片区间拉取目标时长（含 `1.15x` VBR 余量并严格受限于 `cacheMemoryCapMB`）。
- **可调触发时机、切集即停下载与防双份内存堆积**：
  - [`useNextEpisodePreloader.ts`](file:///d:/wade/code/emby-tauri-player/src/player/hooks/useNextEpisodePreloader.ts) 支持 4 种设置页与播放器面板可调触发时机（`smart` / `buffer_ready` / `remaining_time` / `progress` 及对应阈值）并感知手动 `skipSegments` 与 Emby `Chapters` 片头（若下一集已有更靠后观看进度则优先续播位置；播放中途新增/修改片头标记自动作废并重算重拉）。
  - 切入下一集调用 `activate_preloaded_episode` 时，Rust 后端**立即设置 `cancelled` 并 `abort()` 后台下载任务**，仅将已有分块暴露给本机 `127.0.0.1:0` HTTP/1.1 Range 服务瞬间秒开；新集稳定推进后（推进 `>= 15s` 且缓冲 `>= 10s` 或切集 `>= 25s`），或启动再下一集预加载时，自动调用 `release_active_preload_memory` **释放内存分块并保留轻量上游透明 Range 回源代理**；切入非目标集、切换多版本片源/代理或离开播放页立即停止下载并彻底清零内存。

### 24. 全链路 Emby User-Agent / 鉴权头统一与 MPV `-13` 诊断规范 (Unified User-Agent & Stream Headers)
- **禁止放任 `libmpv` 使用裸默认 `User-Agent: libmpv`**：
  - 大量套用 Cloudflare WAF、客户端白名单或 302 网盘直链（如 115 / Alist）的 Emby 公益服会直接拦截 `libmpv` 默认 UA，表现为 API 接口正常但起播立即返回 `end-file` `error: -13 (MPV_ERROR_LOADING_FAILED)`。
  - [`embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts) 统一提供 `DEFAULT_EMBY_USER_AGENT`（桌面 Chrome UA）、`EMBY_USER_AGENT_PRESETS`、解耦解析器 `registerEmbyUserAgentGetter` / `resolveEmbyUserAgent` 以及 `buildEmbyStreamHeaders`；[`useAuthStore.ts`](file:///d:/wade/code/emby-tauri-player/src/stores/useAuthStore.ts) 支持按服务器持久化 `userAgent` 并在备份合并时向后兼容保留。
  - 在 Tauri 环境下，`buildEmbyHeaders`、`MpvPlayerEngine`（`user-agent` + `tls-verify=no`）、[`useNextEpisodePreloader.ts`](file:///d:/wade/code/emby-tauri-player/src/player/hooks/useNextEpisodePreloader.ts) 与 Rust [`preload.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/preload.rs)（`reqwest::ClientBuilder::user_agent`）必须全链路发送同一 `User-Agent`；`buildEmbyHeaders` 仅在 `isTauriEnvironment()` 为 `true` 时注入 `User-Agent`，避免纯浏览器 Dev 模式触发 Fetch 禁改头警告。
- **MPV `http-header-fields` 含逗号头注入红线 (`change-list append`)**：
  - `X-Emby-Authorization` 值内部包含多个逗号分隔字段（`Client="...", Device="...", Token="..."`）。**严禁直接调用 `setProperty('http-header-fields', ...)`**（mpv 会按逗号把字符串列表拆分，导致将 `Device="..."` 当成非法 HTTP 头引发 `400 Bad Request`）。
  - 必须在 [`MpvPlayerEngine.ts`](file:///d:/wade/code/emby-tauri-player/src/player/MpvPlayerEngine.ts) 的 `applyNetworkHeadersToMpv` 中先执行 `command('change-list', ['http-header-fields', 'clr', ''])`，再对每个非 `user-agent` 头逐条调用 `command('change-list', ['http-header-fields', 'append', `${key}: ${val}`])`；同时保留 `MpvPlayerEngine` 初始化后 `user-agent` 与 `end-file` 数字错误码（`-13` ~ `-18`）中文解析。
- **直链构造与 `.strm` 私网防误判**：
  - `buildNativeDirectStreamUrl` 优先透传 `http(s)://` 形式的 `mediaSource.DirectStreamUrl`；若 `IsRemote && Path` 为私网或回环地址（如 `127.0.0.1` / `192.168.x.x`）而服务器地址本身为公网域名，禁止客户端直接请求该内网 `Path`，应回退经 Emby `/emby/Videos/{id}/stream.{ext}?static=true` 代理拉流，且路径与查询参数必须做 `encodeURIComponent`。
- **MPV `demuxer-max-bytes` 属性类型避坑**：
  - `demuxer-max-bytes` 与 `demuxer-max-back-bytes` 在 `mpv` 中属于 `OPT_BYTE_SIZE` 选项，通过 `tauri-plugin-libmpv` 传入 JSON 数字易在某些平台触发 `Failed to set property 'demuxer-max-bytes': error accessing property`。必须在 [`MpvPlayerEngine.ts`](file:///d:/wade/code/emby-tauri-player/src/player/MpvPlayerEngine.ts) 中以 `String(bytes)` 字符串下发。
- **Emby 客户端 `Client` 标识联动与 `PlaybackInfo` 重协商**：
  - 仅改 HTTP `User-Agent` 而不改 `X-Emby-Authorization` 中的 `Client="..."` 仍可能被部分公益服客户端白名单拦截。[`embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts) 通过 `resolveEmbyClientName` 将自定义 UA/预设自动同步至 `Client`（默认配置保持 `EmbyTauriPlayer` 不破坏存量会话）；播放页切换客户端预设后需重新调用 `fetchAndPreparePlaybackSession` 重拉 `PlaybackInfo`。
- **`libmpv` `-13` 自动逐跳诊断与 Rust 零内存透明中转 (`preload.rs`)**：
  - 当 `libmpv` 触发 `-13` 时，[`PlayerPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/PlayerPage.tsx) 自动调用 [`preload.rs`](file:///d:/wade/code/emby-tauri-player/src-tauri/src/preload.rs) 的 `diagnose_stream_url` 逐跳执行 `GET Range: bytes=0-0`（禁用自动重定向，302 跨域自动剥离 `X-Emby-*` / `authorization` 头防网盘拒收，且 URL 敏感 Query 参数强制脱敏）。若 Rust 探测可达（问题出在 `libmpv`/FFmpeg TLS 或跳转兼容），自动切入零内存透明 Range 中转 `start_stream_relay`（单次流仅自动回退一次，离开/切集及时 `stop_stream_relay`）；否则呈现逐跳 HTTP 状态码、`cf-ray` / `cf-mitigated`、响应体片段与无转码 `DirectStreamUrl` 备选重试。

### 25. 首页大图与剧集详情页的 `Episode` 归属与图片降级规范
- **禁止对 `Episode` 直接使用分集自身标题与横版剧照冒充整部剧详情**：
  - 首页 Hero Spotlight 优先取「继续观看」首位，往往为 `Type === 'Episode'`。若直接以 `episode.Id` 跳转详情页并渲染 `item.Name`、`Primary`/`Backdrop`，会出现「大标题显示单集名、2:3 竖版海报拉伸或 404、背景图 404」问题。
  - [`DetailPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/DetailPage.tsx) 在检测到 `item.Type === 'Episode' && item.SeriesId` 时必须并发拉取父级 `Series` 详情（附带 `loadReqIdRef` 防竞态）：大标题、竖版 2:3 海报、全屏氛围背景、年份与剧集主简介优先取 `seriesItem`（并在主标题下方附加单集副标题及「立即/继续播放 第 X 集」按钮）。
- **分集 `Backdrop` 寻址与多级 `onError` 降级**：
  - Emby 分集条目通常没有独立的 `Backdrop`，请求分集 `Backdrop/0` 会返 404。[`HomePage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/HomePage.tsx)、[`DetailPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/DetailPage.tsx) 与 [`PlayerPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/PlayerPage.tsx) 对分集背景图统一优先取 `ParentBackdropItemId || SeriesId` 配合 `ParentBackdropImageTags?.[0]`，禁止把分集的 `BackdropImageTags` 错配给剧集 ID；同时所有海报与背景图必须配置带防重入标记（`dataset.fallbackStep`/`fallbackStage`）的 `onError` 降级链，避免裂图或控制台报错。
  - 首页大图操作分工明确：「立即播放」针对 `Movie`/`Episode` 直接起播进入播放器，「剧集详情」对 `Episode` 自动跳转至 `/detail/${item.SeriesId}`。

### 26. Emby 无标签图片请求触发 500 `NullReferenceException` 防护与统一寻址规范
- **根因机制（无 `&tag=` 盲请求导致大量 HTTP 500）**：
  - 部分 `.strm` / 未完整刮削分集剧照的 Emby 服务端在收到不带 `&tag=` 的图片请求（如 `GET /emby/Items/{id}/Images/Primary?maxWidth=640&quality=85&format=webp`）或强制 `&format=webp` 转码无对应缓存文件条目时，后端图像处理管线不会返回 404，而是直接抛出 `.NET System.NullReferenceException: Object reference not set to an instance of an object.` 返回 **500 Internal Server Error**；当分集列表（[`EpisodeGrid.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/media/EpisodeGrid.tsx)）一次性渲染整季几十上百集时，会瞬间触发海量 500 刷屏报错。
  - 此外，`getSeriesEpisodes` 若未在 `Fields` 中显式声明 `ImageTags,BackdropImageTags,ParentBackdropImageTags`，也可能丢失本已存在的剧照标签。
- **强制 tag 校验与统一图片解析入口 ([`embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts))**：
  - **严禁盲发无 `tag` 图片请求**：禁止任何组件直接用 `undefined` tag 调用 `buildItemImageUrl` 探测图片是否存在，也不得在 `onError` 中剥离 `&tag=` 重试（例如原 `DetailPage` 剥离 tag 重试与 [`MediaCard.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/media/MediaCard.tsx) 未带步进标记的 `onError` 死循环重试）。
  - 统一通过 [`embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts) 提供的 `resolveEpisodeThumbnailUrl`、`resolveItemPosterUrl`、`resolveItemBackdropUrl` 按「自带 tag -> 父级/所属剧集已带 tag 背景/缩略图/封面 -> 空串」顺序寻址；若全部无可用 tag，直接渲染本地暗色占位视图，**零网络请求**。
  - 若带 `tag` 的图片仍偶发请求失败（例如服务端 WebP 编码异常），各视图的 `onError` 必须通过 `dataset.fallbackStep` 或阶段计数器限制重试上限：仅通过 `stripImageFormatWebp` 剥离 `&format=webp`（保留 `&tag=`）重试一次，必要时切换已校验的剧集大图，最终兜底本地内联 SVG 占位图或隐藏 `<img>` 并锁定 `'done'` 状态。
