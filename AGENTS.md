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
  5. GitHub Actions 自动矩阵构建 Windows x64、macOS Apple Silicon (aarch64)、macOS Intel (x86_64)、Linux x64 (deb/AppImage) 全平台安装包并上传至 GitHub Releases。





