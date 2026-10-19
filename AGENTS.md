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
  - WebDAV 直接依托统一 `httpClient` 发送 `PUT` / `GET` / Basic Auth，自动穿透全局代理并绕过 CORS。
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
  - 因此，Pre-release 版本（Alpha / Beta / RC）必须将 tag 命名为 `v0.1.0-alpha.2`，由 GitHub Actions 中的 `contains(github.ref_name, 'alpha')` 自动识别为预发布状态，`tauri.conf.json` 保持为标准数字 SemVer（`0.1.0`）；
- **发布流程自动化触发**：
  1. 更新 `package.json` 及关于页面显示的客户端版本号；
  2. 运行 `pnpm build` 与 `cargo check` 确保零错误；
  3. 提交版本变更并打带注释的标签：`git tag -a v0.1.0-alpha.2 -m "Release v0.1.0-alpha.2: ..."`；
  4. 推送主分支与标签：`git push origin main && git push origin v0.1.0-alpha.2`；
  5. GitHub Actions 自动矩阵构建 Windows x64 (NSIS)、macOS Apple Silicon (aarch64)、macOS Intel (x86_64)、Linux x64 (deb) 全平台安装包并上传至 GitHub Releases。
- **打包目标精简与多平台构建性能优化规范**：
  - Windows 仅构建 NSIS (`.exe`) 一键安装包，彻底移除 WiX MSI 生成，避免对 100MB `libmpv` 进行二次高强度重复压缩（节省 4~5 分钟）；同时在 Windows 构建前置将工程目录与 `cargo.exe`/`rustc.exe`/`link.exe` 加入 Windows Defender 排除项，消除磁盘实时查杀锁盘延迟；
  - Linux 仅保留 `.deb` 安装包，彻底移除 AppImage 打包，消除 `mksquashfs` 的重度 CPU 压缩开销（节省约 3 分钟）；依赖安装启用 `--no-install-recommends` 减少非必要包下载；
  - macOS 维持单一 `.dmg` 极速打包。
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
  - **CI 打包规范**：macOS Apple Silicon (`macos-15`) 与 Intel (`macos-15-intel`) 分别在原生架构 Runner 上通过 `dylibbundler` 将 `libmpv.dylib` 及其全部非系统依赖动态库、连同 `libMoltenVK.dylib` 与 `MoltenVK_icd.json` 一并打包进 `src-tauri/lib/`，重写 `@loader_path/` 并对所有 `.dylib` 执行 `codesign --force --sign -` 重签名；
  - **Rust 运行时兜底 (`init_macos_mpv_environment`)**：启动时自动将内置或系统（Homebrew/MacPorts/IINA）的 `libmpv.dylib` 软链至 `Contents/MacOS/libmpv.dylib`、`Contents/Resources/lib/libmpv.dylib` 以及 `$HOME/lib/libmpv.dylib`（确保即使在只读 DMG 中直接运行也能通过 `dyld` 默认 `$HOME/lib` 回退路径成功加载），并自动注入 `VK_ICD_FILENAMES` / `VK_DRIVER_FILES`。
