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

### 2.2 “继续观看”与“最近播放”过滤与聚合规则
1. **坚决排除非视频内容**：
   - 音乐、音频（Audio）、歌单（MusicAlbum/Playlist）等**一律不展示**在“继续观看”和“最近播放”中。
   - 判定标准：[`isVideoMedia(item)`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts)（严格校验 `MediaType === 'Video'` 且排除 `Audio`/`Music`）。
2. **剧集按相同媒体聚合（去重）**：
   - 同一部电视剧（Series）观看过多集时，只在“继续观看”卡片中保留**最新观看的那一集**，并在卡片上注明集数（例如 `第 5 集`）与准确进度条。
   - 聚合函数：[`mergeMediaBySeries(items)`](file:///d:/wade/code/emby-tauri-player/src/api/embyClient.ts)。
3. **封面海报完整性保障**：
   - 单集视频可能未单独上传海报，解析图片时需优先读取自身海报，若缺失则级联回退到电视剧集封面：`SeriesPrimary` -> `ParentBackdropImageTags` -> `Primary`，确保所有“继续观看”卡片均具有完整封面海报。

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
- **无边框窗口控制**：
  - 非播放页：展示统一自定义标题栏 [`TitleBar.tsx`](file:///d:/wade/code/emby-tauri-player/src/components/layout/TitleBar.tsx)，左上角包含 Nocta App Logo 与应用标题，右上角包含最小化、最大化/还原、关闭。
  - 播放页：隐藏原生标题栏，由沉浸式顶部悬浮栏提供返回、最小化、全屏切换与关闭。

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
- **多平台多架构编译矩阵**：
  - **Windows x64** (`windows-latest`)：输出 `.exe` (NSIS) 与 `.msi` (WiX)；
  - **macOS Apple Silicon** (`macos-latest`, `--target aarch64-apple-darwin`)：输出原生适配 M 系列芯片的 `*_aarch64.dmg`；
  - **macOS Intel** (`macos-latest`, `--target x86_64-apple-darwin`)：输出适配 Intel 处理器的 `*_x64.dmg`；
  - **Linux x64** (`ubuntu-22.04`)：输出 `.deb` 与 `.AppImage`。
- **发布产物与自动更新日志**：
  - 自动生成 GitHub Release 并挂载全部平台安装包资产；
  - 启用 `generateReleaseNotes: true`，调用 GitHub 官方 API 自动比对提取提交日志；
  - 配合 `.github/release.yml` 规则自动按功能（Features）、修复（Bug Fixes）、性能（Performance）和工程维护（Maintenance）分类展示更新内容；
  - Release 正文中附带 macOS 首次打开拦截（Gatekeeper `com.apple.quarantine`）的终端与系统设置解决方案。

