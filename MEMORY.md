# Nocta (夜幕) · 项目核心架构与上下文记忆 (Project Memory)

> 本文件持久记录 Nocta 播放器项目的核心架构、关键业务规则、排坑指南与配置约束，供后续所有 AI 会话与协同开发使用。

---

## 1. 项目基本概况与命名

- **应用名称**：`Nocta` · `夜幕`
  - 英文名：Nocta（源自拉丁语 Nox 夜晚，发音 /ˈnɒktə/）
  - 中文名：夜幕（一语双关：暗色沉浸私人影院，银幕与弹幕的双重盛宴）
- **Git 仓库**：`git@github.com:wade6716/Nocta.git`（分支 `main`）
- **Git 提交身份约束**（**至关重要**）：
  - 邮箱：`59910348+wade6716@users.noreply.github.com`
  - 用户名：`Wade`
  - *注：必须使用 noreply 隐私邮箱提交，否则 GitHub 会拒绝远程推送（push declined due to email privacy restrictions）。*
- **技术栈架构**：
  - 跨平台壳层：**Tauri 2.0** (`@tauri-apps/api`, `@tauri-apps/plugin-http`)
  - 前端框架：**React 18** + **TypeScript** + **Vite**
  - 样式与图标：**TailwindCSS** + **Lucide React**
  - 全局状态管理：**Zustand**（包含持久化 localStorage 机制）
  - 播放内核：HTML5 `<video>` + **HLS.js**（支持 Emby HLS 转码及 DirectStream 直链回退）
  - 弹幕引擎：基于 `wade6716/Danmaku` 高性能 Canvas 弹幕渲染器

---

## 2. 媒体库核心逻辑（Emby / Jellyfin 兼容）

### 2.1 记住上次登录的服务器
- 客户端在启动或登录时，通过 `useAuthStore` 自动将当前选中的服务器 ID 持久化至 `emby_current_server_id`。
- 启动时自动恢复并加载最后一次使用的服务器；如果配置了多个 Emby 服务器，可在首页或登录页随时切换。

### 2.1.1 服务器信息的编辑（Emby Server Management）
- **入口**：
  - 首页顶栏 `Server` 图标按钮，或点击标题旁当前的服务器名称徽标（带铅笔提示）；
  - 登录页「已保存的服务器」列表中的编辑按钮与右上角「管理」按钮。
- **组件**：[`EmbyServerModal.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/settings/EmbyServerModal.tsx)
  （支持列表查看、新增、编辑、切换、删除，样式与弹幕节点弹窗保持一致）。
- **编辑规则（关键）**：
  - 仅修改**名称**时不做网络请求，直接经 `useAuthStore.updateServer` 落库；
  - 修改**地址 / 用户名**或填写了**新密码**时，先 `testServerConnection` 再做 `authenticateByName`，成功后一次性更新 `url / userId / username / accessToken`；
  - 编辑采用**原地更新**（保留原有服务器 ID 与 `lastActive` 排序，不改变当前选中项），避免产生重复条目；
  - 若被编辑的正是当前使用的服务器，必须调用 `useMediaStore.clearMediaCache()` 作废旧媒体库缓存，并且 [`HomePage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/HomePage.tsx) 的加载 effect 依赖 `currentServer?.url` 与 `currentServer?.accessToken`，确保换址/换令牌后自动重新拉取媒体库。
- **记住并可查看密码**：
  - `SavedServer` 增加可选字段 `password`，登录/新增/重新认证成功后与 `accessToken` 一起写入本机 `localStorage`（`emby_auth_store`）。
  - 查看入口：服务器列表每行的眼睛按钮（明文展开，同时只展开一台）；编辑弹窗密码框会自动预填，配合右侧眼睛按钮查看。
  - 判定重连的依据是 `password !== (original.password ?? '')`，而非"密码框非空"，因此预填密码后仅改名称不会误触发重新登录。
  - 早期版本保存、未留存密码的服务器：列表不显示眼睛按钮，编辑时给出"重新输入并保存一次即可查看"的提示。
  - **安全边界**：密码为明文本地存储（与既有 `accessToken` 同一安全等级），弹窗内已向用户明示，勿在共享设备上使用。
- **连接失败也能保存 + 主动测速（重要）**：
  - 保存流程**绝不被连接失败阻断**：`probeServer()` 内部捕获全部异常并只返回结果对象，保存时无论如何都会把用户填写的名称/地址/用户名/密码落库。
  - 连接/登录失败时的落库规则：仍写入用户填写内容并标记 `lastTestOk = false` + `lastTestError`；**地址发生变更时清空旧 `userId`/`accessToken`**（旧令牌对上新地址已不可信），地址未变则保留旧令牌。
  - 离线**新增**的服务器以 `addOrUpdateServer(payload, { makeCurrent: false })` 保存，不抢占当前选中项，避免首页加载出空媒体库。
  - **测试连接按钮**有两处：表单内「测试连接」（只探测不落库，结果实时展示）；列表每行的测速按钮（结果写回该条记录的 `lastTestOk/lastTestError/lastTestAt`）。
  - 结果分级：`服务器可达 · 名称 · xx ms，登录校验通过`（绿）／`服务器可达但登录校验未通过`（黄）／`无法连接`（红）。
  - 行内测速的**登录校验只在已记住密码时执行**（`password !== undefined`），否则只做连通性探测，避免用空密码把在线服务器误判为失败。
  - `SavedServer` 新增 `lastTestOk` / `lastTestError` / `lastTestAt`；首页在当前服务器 `lastTestOk === false` 时展示琥珀色横幅并引导到服务器管理弹窗。

### 2.2 “继续观看”与“最近播放”过滤与聚合规则
1. **坚决排除非视频内容**：
   - 音乐、音频（Audio）、歌单（MusicAlbum/Playlist）等**一律不展示**在“继续观看”和“最近播放”中。
   - 判定标准：[`isVideoMedia(item)`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts)（严格校验 `MediaType === 'Video'` 且排除 `Audio`/`Music`）。
2. **剧集按相同媒体聚合（去重）**：
   - 同一部电视剧（Series）观看过多集时，只在“继续观看”卡片中保留**最新观看的那一集**，并在卡片上注明集数（例如 `第 5 集`）与准确进度条。
   - 聚合函数：[`mergeMediaBySeries(items)`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts)。
3. **封面海报完整性保障**：
   - 单集视频可能未单独上传海报，解析图片时需优先读取自身海报，若缺失则级联回退到电视剧集封面：`SeriesPrimary` -> `ParentBackdropImageTags` -> `Primary`，确保所有“继续观看”卡片均具有完整封面海报。

### 2.3 播放进度恢复与记忆保障机制（关键排坑）
1. **HTML5 `<video>` 起播首跳**：
   - 浏览器原生 `<video>` 挂载时默认从 0:00 秒开始播放，必须在 `onLoadedMetadata` / `onCanPlay` 触发时显式将 `video.currentTime` 赋值为 `initialTime`；
   - 增加 `hasInitialSeekedRef` 标记，首跳执行前拦截前几十毫秒原生 `0` 秒触发的 `onTimeUpdate` 事件，防止瞬杀冲刷全局 Store 中的真实历史进度。
2. **完播防回滚保护**：
   - 若 `initialTime` 距片尾不足 15 秒或已达总时长 98%，视为已完播，自动忽略历史进度从 0:00 重新播放。
3. **闭包过时（Stale Closure）防护**：
   - `useEffect` 销毁时的 `reportPlaybackStopped` 与心跳定时器绝不能直接捕获组件作用域的旧 `currentTime`，必须通过 `videoElemRef.current?.currentTime ?? usePlayerStore.getState().currentTime` 实时读取真实现场秒数，杜绝将 0 秒反向回写覆盖 Emby 服务端。

---

## 3. 弹幕系统规范（Danmaku）与 `danmu_api` 对接

### 3.1 去捆绑化架构设计
- **完全解耦**：客户端绝不捆绑、打包或附带任何 `danmu_api` 服务端后端程序。
- **纯 HTTP 消费者**：客户端仅作为消费者通过配置的服务地址进行 REST API 请求，规避客户端臃肿及端口冲突。

### 3.2 Token 包含在地址中（无单独 Token 输入项）
- **规范格式**：Token 直接嵌入在服务 URL 的末尾，例如：
  - 本地：`http://127.0.0.1:9321/87654321`
  - 远程/VPS：`http://vps-domain.com:9321/your_custom_token`
- **解析与路由原理**：
  - `danmu_api` 的 `worker.js` 会把请求的第一段路径提取为 Token，校验通过后自动将其从 URL 中剥离并转发至具体接口。
  - 前端 UI 中**严禁**再提供单独的 Token 输入框，统一让用户直接在地址中填写。

### 3.3 节点健康探测（Ping 测速）排坑规范（重要）
- **禁止调用不存在的 `/api/v2/version`**：
  - `danmu_api` 服务端**没有** `/api/v2/version` 路由！若请求该路由会始终返回 HTTP 404，导致客户端测速时误报“离线”。
- **标准健康检测接口**：
  - **首选**：`${base}/api/config`（返回 HTTP 200 即为正常在线；若返回 HTTP 401/403 即为 Token 错误）。
  - **回退机制**：若对方是第三方官方弹弹play等无 `/api/config` 的节点，自动降级请求 `POST /api/v2/match`（`{ fileName: "ping" }`）或 `GET /` 进行二次探测。
  - **状态反馈**：精确区分 `离线`（网络不通/未开机）、`Token 错误`（HTTP 401）和真实延迟（`xx ms`）。

### 3.4 手动搜索弹幕与剧集绑定
- **自动匹配**：播放视频时，先根据文件名及剧集名称发起 `POST /api/v2/match` 自动拉取弹幕。
- **手动搜索换绑**：
  - 播放器内置手动弹幕搜索弹窗（`DanmuSearchModal`），支持按影视番剧名称搜索分集列表。
  - 用户选定具体分集后，自动将该集弹幕 ID 绑定到当前 Emby 单集视频（保存在 localStorage `emby_danmu_bindings`）。
  - 后续再次播放该视频时，优先读取该专属绑定弹幕。
- **播放器 OSD 信息指示**：
  - 播放器控制栏清晰显示当前弹幕挂载来源及剧集标题，并支持一键开启搜索面板调整。

### 3.5 弹幕渲染控制与彩色模式
- **参数控制**：支持实时调节弹幕显示区域/行数、不透明度（0~100%）、字体大小、滚动速度及显示/隐藏。
- **时间轴微调（Offset）**：支持 `+0.5s` / `-0.5s` 微调弹幕时间偏移，并按剧集自动记忆。
- **色彩模式**：
  - `vibrant`：多彩弹幕（保留源站全彩特效）。
  - `monochrome`：纯白模式（所有彩色弹幕转为纯白色）。
  - `blocked`：屏蔽彩弹（仅保留普通白色弹幕，丢弃带颜色的弹幕）。

### 3.6 宽银幕画面沉浸贴底与顶部留黑（弹幕空间优化）
- **实现原理**：针对 2.35:1 / 2.39:1 / 21:9 等宽银幕视频，通过 CSS `object-position: center ${verticalOffset}%` 将画面平滑靠底，彻底消除底部黑边，将全部多余黑边合并至屏幕顶部作为专属弹幕滑行区，防止遮挡人物与台词。
- **微调与预设**：支持 50%（居中）至 100%（贴紧底边）平滑滑动微调，并附带“完全贴底 100%”、“微浮避让 95%”和“居中 50%”一键预设。
- **按剧隔离记忆**：以 `series_${SeriesId}` 作为存储键持久化在 `emby_video_layout_configs`，同剧各分集自动共享，不同影视剧之间完全隔离。

---

## 4. 应用图标（App Icons）规范与存放指南

- **矢量母版文件**：[`app-icon.svg`](file:///d:/wade/code/emby-tauri-player/app-icon.svg)（位于项目根目录，夜幕主题渐变、播放棱镜与三色弹幕光轨设计）。
- **Tauri 打包与系统图标**：存放在 [`src-tauri/icons/`](file:///d:/wade/code/emby-tauri-player/src-tauri/icons/)：
  - `icon.ico`：Windows 客户端与安装程序图标
  - `icon.png`：512x512 高清启动图标
  - `icon.icns`：macOS 应用图标
  - `32x32.png`、`128x128.png` 等多尺寸系统图标
  - *一键全自动编译命令*：`pnpm tauri icon app-icon.svg`
- **前端与界面图标**：
  - 存放在 [`public/app-icon.svg`](file:///d:/wade/code/emby-tauri-player/public/app-icon.svg)
  - 作用：HTML Favicon（[`index.html`](file:///d:/wade/code/emby-tauri-player/index.html)）及无边框自定义窗口标题栏（[`TitleBar.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/layout/TitleBar.tsx)）Logo 图标。

---

## 5. 项目窗口与标题规范

- **桌面窗口标题**：统一为 `Nocta · 夜幕`（[`tauri.conf.json`](file:///d:/wade/code/emby-tauri-player/src-tauri/tauri.conf.json)、[`index.html`](file:///d:/wade/code/emby-tauri-player/index.html)、[`App.tsx`](file:///d:/wade/code/emby-tauri-player/src/App.tsx)）。
- **无边框窗口控制与播放页交互规范**：
  - 非播放页：展示统一自定义标题栏 [`TitleBar.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/layout/TitleBar.tsx)，左上角包含 Nocta App Logo 与应用标题，右上角包含最小化、最大化/还原、关闭。
  - 播放页（交互与布局参考哔哩哔哩）：
    - **无遮挡顶部栏**：彻底取消播放界面右上角的窗口控制按钮，避免遮挡右侧弹幕控制中心；左上角集成“返回”与“首页”快捷按钮及剧集标题。
    - **双击全屏与画面手势**：双击视频画面任意空白处切换全屏，单击切换播放/暂停（附带屏幕中央微动效指示徽标），防抖避免双击误触发暂停。
    - **右下角双全屏控制**：控制栏右下角分别提供“窗口全屏 / 还原窗口”（`AppWindow`）与“屏幕全屏”（`Maximize`/`Minimize`）按钮。
    - **弹幕控制移至底部**：底部控制栏居中提供弹幕开关（快捷键 D）与弹幕设置抽屉入口。
    - **弹幕设置抽屉优化**：抽屉层级升至最高 `z-50`，支持点击外部半透明遮罩快速关闭，右上角关闭按钮完全无遮挡，按 `Esc` 优先关闭抽屉。

---

## 6. 常用开发与构建指令

```bash
# 1. 安装依赖
pnpm install

# 2. 前端代码构建检查（类型与打包测试）
pnpm build

# 3. 桌面端本地开发启动
pnpm tauri dev

# 4. 图标更新与编译（母版更新时执行）
pnpm tauri icon app-icon.svg

# 5. 桌面安装包构建
pnpm tauri build
```

---

## 7. GitHub Actions 自动化 CI/CD 与发版流程

### 7.1 CI 流水线 (`.github/workflows/ci.yml`)
- **触发条件**：向 `main` 分支提交代码或发起 Pull Request 时自动触发；
- **任务内容**：
  - `frontend-check`：验证前端 TypeScript 类型检查与 Vite 打包（`pnpm build`）；
  - `rust-check`：在 Ubuntu 与 Windows 矩阵运行 `cargo check`，确保 Rust 后端语法与依赖无冲突。

### 7.2 自动编译发版流水线 (`.github/workflows/release.yml`)
- **触发条件**：
  - **标签触发**：推送 `v*` 格式版本标签（例如 `git tag v0.1.0 && git push origin v0.1.0`）；
  - **手动触发**：GitHub Actions 界面手动 `workflow_dispatch`，可选择草稿（Draft）或预发版（Pre-release）。
- **多平台多架构编译矩阵与产物命名**：
  - **Windows x64** (`windows-latest`)：输出带平台标识的 `Nocta_*_windows_x64-setup.exe` (NSIS) 与 `Nocta_*_windows_x64.msi` (WiX)；
  - **macOS Apple Silicon** (`macos-latest`, `--target aarch64-apple-darwin`)：输出原生适配 M 系列芯片的 `Nocta_*_macos_aarch64.dmg`；
  - **macOS Intel** (`macos-latest`, `--target x86_64-apple-darwin`)：输出适配 Intel 处理器的 `Nocta_*_macos_x64.dmg`；
  - **Linux x64** (`ubuntu-22.04`)：输出 `Nocta_*_linux_x64.AppImage` 与 `Nocta_*_linux_x64.deb`。
- **发布产物与自动更新日志机制**：
  - 矩阵编译完成后，通过专属 `finalize-release` 任务调用 GitHub API 强制刷新已有 Release 的正文与更新日志（使用 `.github/release-template.md` 模板与 `.github/release.yml` 规则分类），彻底解决重新发版时 GitHub 不刷新旧 Release Body 的问题；
  - 自动检测并清理历史遗留的不含平台标识的前代产物（如 `Nocta_0.1.0_x64-setup.exe`）；
  - Release 正文中置顶展示系统与芯片对应下载表格，并附带 macOS 首次打开拦截（Gatekeeper `com.apple.quarantine`）的终端与系统设置解决方案。

---

## 8. 原生播放器内核 (libmpv Native Player Engine) 与统一接口

### 8.1 架构设计背景
- **痛点**：Chromium / WebView2 缺失 MKV 容器支持及 DTS/TrueHD 等多声道商用音频授权，导致 Emby 服务端不得不强制进行 `DirectStream` 重封装或降级转码，NAS/服务器 CPU 占用高且无法享受高品质音画。
- **方案**：采用 **Tauri 2.0 + `libmpv` (tauri-plugin-libmpv) + 双层穿透视窗 (Window Layering)**。

### 8.2 统一播放器引擎接口 (`IPlayerEngine`)
- 位于 [`src/player/types.ts`](file:///d:/wade/code/emby-tauri-player/src/player/types.ts)，抽象出播放、暂停、跳转、音量、倍速、音轨切换、字幕切换、宽银幕底对齐等统一接口。
- **实现类**：
  1. [`MpvPlayerEngine`](file:///d:/wade/code/emby-tauri-player/src/player/MpvPlayerEngine.ts)：基于 `tauri-plugin-libmpv-api` 驱动底层的 `libmpv-2.dll` 进行 Direct3D11/Vulkan 硬件硬解。
  2. [`Html5PlayerEngine`](file:///d:/wade/code/emby-tauri-player/src/player/Html5PlayerEngine.ts)：封装标准 HTML5 `<video>` 元素，作为 Web 开发调试和兼容回退引擎。
  3. [`PlayerEngineFactory`](file:///d:/wade/code/emby-tauri-player/src/player/PlayerEngineFactory.ts)：根据运行环境与用户偏好自动实例化引擎。

### 8.3 Emby 服务端 0 转码直出 (`buildNativeDirectStreamUrl`)
- 在 [`src/api/embyClient.ts`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts) 中增加 `buildNativeDirectStreamUrl`，强制以 `static=true` 直取原始文件流。
- 完全废除针对 MKV 的 `VideoCodec=copy&AudioCodec=aac` 强制重封装，本地直接硬解 HEVC/AV1/VC-1 并直解/直通 DTS-HD MA、Dolby TrueHD、Atmos 与 EAC3。

### 8.4 双层穿透渲染 (Window Layering) 与 Canvas 弹幕融合
- `src-tauri/tauri.conf.json` 开启 `"transparent": true`。
- 根容器 `App.tsx` 在非播放路由使用坚实的 `bg-background`（`#0f1115`），仅在 `/player` 路由变为 `bg-transparent`。
- 底层 GPU 视频表面直接显露，顶层透明 WebView 承载 120Hz/144Hz Canvas 弹幕（[`DanmakuLayer.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/player/DanmakuLayer.tsx)）与现代 OSD 控制栏（[`PlayerOsd.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/player/PlayerOsd.tsx)），并接管所有点击与快捷键事件。
- 宽银幕底对齐通过 mpv 的 `video-align-y` 属性（0.0 居中 ~ 1.0 完全贴底）原生调节，丝滑无卡顿。

### 8.5 视窗穿透与原生视频画面遮挡避坑指南 (Critical Pitfalls)
1. **全局 CSS `#root` 背景色遮挡**：
   - Tauri 窗口即使开启了 `"transparent": true`，若 `src/index.css` 的 `html, body, #root` 存在不透明背景色（如 `background-color: #0f1115;`），WebView2 将会把该深色完整渲染出来，从而 100% 遮盖底层 Win32 硬件表面，表现为「只有弹幕在黑色背景上飞过，画面完全不可见」；
   - **规范**：`src/index.css` 的 `html, body, #root` 必须保持 `background-color: transparent;`，深色背景由 [`App.tsx`](file:///d:/wade/code/emby-tauri-player/src/App.tsx) 根据路由按需动态赋予。
2. **缓冲状态监听不可使用 `core-idle`**：
   - `core-idle` 在解复用、起播初始缓冲及跳进度时均为 `true`，极易导致播放器卡在 `buffering` 状态；
   - **规范**：必须监听 `paused-for-cache` 判断网络缓存下溢，且在 `time-pos` 推进时主动重置 `_isBuffering = false` 并解除上层 Loading 遮罩。

---

## 9. 网络代理架构 (Network & Proxy Architecture)

### 9.1 原生播放器与系统代理脱节问题
- **痛点**：默认情况下，Windows 下原生 `libmpv`（通过 FFmpeg 网络栈）仅在系统环境变量包含 `HTTP_PROXY` 时才会走代理，**绝不会自动读取 Windows 注册表中的系统代理 (WinINet)**（如 Clash / v2rayN 打开系统代理时写入的 `127.0.0.1:7890`）。导致用户即便开启了系统代理，原生视频播放仍然以直连方式访问，海外/代理服务器加载超时。
- **解决**：打通 Rust 原生探测 -> 前端代理中枢 -> `libmpv` / `httpClient` 双向注入机制。

### 9.2 跨平台系统代理自动探知 (`src-tauri/src/proxy.rs`)
- 提供 `get_system_proxy` Tauri 命令：
  - **Windows**：直接读取 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 中的 `ProxyEnable` 与 `ProxyServer`，支持 `127.0.0.1:7890`、复合分号格式与 socks 格式；
  - **macOS**：通过 `sysproxy`（`networksetup`）读取当前活动接口的 HTTP/HTTPS/SOCKS 代理；
  - **Linux**：通过 `sysproxy` 读取 GNOME `gsettings` 代理；
  - **环境变量兜底**：若操作系统未启用，扫描 `ALL_PROXY`、`HTTPS_PROXY`、`HTTP_PROXY` 及其小写版本；
  - 标准化输出完整 URL 格式（如 `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:10808`）。

### 9.3 统一代理中枢与播放器透传
- **前端网络层**：[`src/api/http.ts`](file:///d:/wade/code/emby-tauri-player/src/api/http.ts) 提供 `resolveEffectiveProxy()` 与 `registerProxyGetter()`，为所有 `httpClient`（Emby API / 弹幕）请求动态附加 `{ proxy: { all: proxyUrl } }`。
- **原生播放器内核**：[`MpvPlayerEngine.ts`](file:///d:/wade/code/emby-tauri-player/src/player/MpvPlayerEngine.ts) 在 `init()` 阶段注入 `initialOptions['http-proxy'] = proxyUrl`，并在每次 `load()` 新视频时动态同步 `setProperty('http-proxy', proxyUrl || '')`。
- **UI 配置与多目标测速**：系统设置页 [`SettingsPage.tsx`](file:///d:/wade/code/emby-tauri-player/src/pages/SettingsPage.tsx) 与弹窗 [`NetworkProxyModal.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/settings/NetworkProxyModal.tsx) 均支持一键切换「跟随系统代理 (默认)」、「手动自定义 (HTTP/SOCKS5)」、「强制直连」，并提供测试目标下拉选择框（1. Google 全球连通性 / 2. 当前 Emby 服务器 / 3. 自定义网址输入），探测往返延迟与链路健康状态。

---

## 10. 跨 Emby 服务器与媒体库聚合搜索中心 (Cross-Server & Cross-Library Federated Search)

### 10.1 搜索架构与服务端排坑
1. **跨多个 Emby 服务器联合并发检索**：
   - 用户往往在 Nocta 中配置并保存了多台 Emby 服务器（如家用 NAS、朋友服、海外 VPS 备用服）；
   - 搜索中心支持以「全部服务器」为默认范围并发调度（`searchFederatedMediaItems`），通过 `Promise.allSettled` 并发向所有配置的服务器派发检索任务；
   - 任何单台服务器超时、连接失败或离线（`lastTestOk === false`），通过独立的 try-catch 容错记录在 `stats` 中并在前端状态栏给出温和的琥珀色提示，绝不抛出异常阻断其他健康服务器的搜索呈现。
2. **单服务器内部的分库穿透（从全局搜索中排除机制）**：
   - Emby 服务器管理员常在特定媒体库（动漫、纪录片、4K 库等）高级设置中勾选「从全局搜索结果中排除」，无 `ParentId` 的全局接口会直接漏查；
   - 解决方案：并发发起用户全部分类视图检索（带 `ParentId=${view.Id}` 穿透）、全局检索与 `/emby/Search/Hints`，全量汇总并去重。
3. **所属服务器与媒体库双重标识注入**：
   - 搜出的每个影视条目均注入 `ServerId`、`ServerName`、`ServerUrl` 以及 `LibraryName`、`LibraryId`；
   - `MediaCard` 优先使用 `item.ServerUrl || serverUrl` 请求海报图片，避免因跨服务器请求导致海报 401/404；
   - 卡片左上角标明所属服务器（如 `[NAS]`），右上角标明所属媒体库（如 `[动漫]`）。
4. **跨服点击无缝迁移与平滑播放**：
   - 用户在搜索结果中点击非当前活动服务器的卡片时，系统在跳转前自动调用 `useAuthStore.setCurrentServer(item.ServerId)` 并执行 `useMediaStore.clearMediaCache()`；
   - 随后导航至 `/detail/${item.Id}`，详情页与播放器将直接使用该目标服务器的 Token 与直链播放，免去手动换服步骤。
5. **多级筛选胶囊体系**：
   - 第 1 级（类型）：全部影视 / 电影 / 剧集；
   - 第 2 级（服务器）：全部服务器 (共 N 部) / 各独立服务器名称 (带健康状态与部数)，点击一键过滤；
   - 第 3 级（媒体库）：选定单台服务器时展示该服务器下的分类库胶囊。
6. **电视剧集数（媒体文件）角标系统**：
   - Emby 中剧集条目总集数为 `RecursiveItemCount`，季数为 `ChildCount`；
   - API 请求必须显式在 `Fields` 声明 `ChildCount,RecursiveItemCount,Status`，否则服务端会默认截断；
   - 卡片在封面右下角渲染半透毛玻璃角标：已完结展示 `全 X 集`，连载中展示 `更新至 X 集`，单集展示 `第 X 集`，与左上角服务器、右上角媒体库无重叠协同呈现。

---

## 11. 播放器媒体技术信息面板 (Playback Information & Stats HUD)

### 11.1 功能定位与体验设计
- **非模态非阻断 HUD**：
  - 传统设置弹窗往往会阻断视频交互或遮盖整个屏幕；
  - Nocta 采用专业级媒体播放信息 HUD（`PlaybackInfoModal`），以深色半透毛玻璃悬浮在视频播放画面右上侧，用户可边观看视频边实时监测各项音视频解码技术指标。
- **快捷交互入口**：
  - OSD 控制栏右侧常驻专属信息按钮（`<Info />`），鼠标悬停显示工具提示与快捷键说明；
  - 快捷键：支持键盘单键 `I`（Info）秒级开关，按 `Escape` 优先收起。

### 11.2 六大技术数据分类体系
1. **播放状态 (Playback Status)**：
   - 当前时间 / 影片总长与精确播放百分比；
   - 播放倍速；
   - 传输模式（DirectStream 原始直连 / 兼容重封装 / 转码流）；
   - 当前连接的 Emby 媒体服务器名称。
2. **视频流参数 (Video Stream)**：
   - 画质分辨率（如 3840×2160 4K、1920×1080 1080p）与宽高比；
   - 编码格式（HEVC、H.264、AV1、VP9 等）；
   - 实时与平均帧率（fps）；
   - 色彩位数（10-bit / 8-bit）；
   - 动态范围标准（HDR10 / Dolby Vision / SDR、BT.2020、SMPTE ST 2084）；
   - 编码规格 Profile / Level 与视频码率（Mbps / kbps）。
3. **音频流参数 (Audio Stream)**：
   - 当前生效音轨名称与语言；
   - 音频编码格式（Dolby TrueHD、DTS-HD MA、FLAC、AAC、AC3 等）；
   - 声道布局（7.1 Surround、5.1 Surround、Stereo 立体声）；
   - 采样率（如 48 kHz、96 kHz）与音频码率。
4. **字幕流参数 (Subtitle Stream)**：
   - 当前加载字幕标题与语言；
   - 字幕格式（ASS 动态特效字幕、SRT 纯文本字幕、PGS 图形字幕等）；
   - 装载方式（外挂 External / 内嵌 Embedded）。
5. **播放内核与环境 (Player Engine & Hardware)**：
   - 播放器引擎类型（基于 Rust + libmpv 原生 GPU 硬件解码 / HTML5 Video 网页解码）；
   - GPU 硬件加速状态与渲染管线。
6. **存储容器与弹幕源 (Container & Danmaku)**：
   - 容器格式（MKV / MP4 / TS 等）与服务器原始物理文件路径；
   - 弹幕匹配源番剧及单集标题；
   - 当前挂载弹幕总条数与微调时间偏移（±秒数）。

### 11.3 一键诊断报告复制
- 面板底部配备「复制全部信息」按钮，点击自动将所有结构化音视频元数据复制为整洁的 Markdown / 纯文本格式，方便向服务器管理员提供排障日志。





