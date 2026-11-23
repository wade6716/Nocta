<div align="center">
  <img src="public/app-icon.svg" width="128" height="128" alt="Nocta Logo" />
  <h1>Nocta · 夜幕</h1>
  <p><strong>暗色沉浸式私人影院 · 银幕与弹幕的双重盛宴</strong></p>
  <p>基于 Tauri 2.0 + Rust + libmpv 构建的现代化 Emby / Jellyfin 桌面客户端，集成 4K HDR 零转码硬解、全网弹幕彩色渲染、纯内存下一集预加载与端到端加密多端同步</p>

  <p>
    <a href="https://github.com/wade6716/Nocta/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/wade6716/Nocta/ci.yml?branch=main&label=CI&style=flat-square&logo=githubactions&logoColor=white" alt="CI Status" /></a>
    <a href="https://github.com/wade6716/Nocta/releases"><img src="https://img.shields.io/github/v/release/wade6716/Nocta?style=flat-square&logo=github&color=38BDF8" alt="GitHub Release" /></a>
    <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" /></a>
    <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" /></a>
    <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-2021-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platforms" />
  </p>
</div>

---

## 📖 简介 (Introduction)

**Nocta**（/ˈnɒktə/，拉丁语 *Nox*，意为“夜晚”；中文名 **“夜幕”**）是一款专为追求极致视听与沉浸观影体验的影迷打造的开源跨平台桌面播放器客户端。

中文“夜幕”一语双关——既是专为深夜观影调校的暗色私人影院，又将**“银幕”与“弹幕”**深度融合。相比传统基于浏览器的 Emby/Jellyfin 客户端，Nocta 通过 **Tauri 2.0 + Rust + `libmpv` 双层透明穿透视窗**实现了真正的全格式零转码硬件直解，并将高帧率 Canvas 弹幕、多服务器跨库搜索、纯内存剧集预加载与多端加密同步整合进轻量极速的原生桌面体验中。

---

## ✨ 核心特性 (Key Features)

### 🎬 1. `libmpv` 原生 GPU 硬解 · 100% 零转码原画直出
- **双层穿透渲染架构**：底层由 `libmpv` 通过 Direct3D11 / Vulkan / VideoToolbox 硬件直解 **MKV、HEVC (H.265)、AV1、VC-1、4K HDR10 / Dolby Vision** 及 **DTS-HD MA / Dolby TrueHD / Atmos / EAC3** 原音音轨，**0% 服务端转码开销**；上层透明 WebView 承载 120Hz/144Hz 弹幕与控制面板（Windows/Linux `--wid` 原生嵌入；macOS 原生窗口贴合与全屏独立透明浮层完全对等）。
- **专业画质与音频调校面板**：支持硬解策略切换（`auto-safe` / `auto` / `auto-copy` / `no`）、HDR 色调映射 (`tone-mapping`)、动画去色带 (`deband`)、亮度/对比度/饱和度/伽马调节、画面比例填充、双语次字幕 (`secondary-sid`)、拖放加载本地 `.srt/.ass/.vtt` 外挂字幕、200% 软件音量增益、夜间人声动态均衡 (`dynaudnorm`)、A-B 循环与无损 PNG 截图。
- **非阻断式播放信息 HUD & 无遮挡网速浮标**：按 `I` 键呼出实时硬解遥测与媒体技术参数浮层（支持一键复制排查报告）；播放中途缓冲仅呈现不遮挡画面的实时下载网速微标。

### 💬 2. 全网弹幕生态与高帧率渲染
- **纯 HTTP 消费者架构**：客户端绝不捆绑任何弹幕服务端；Token 直接附带在节点 URL 路径末尾（如 `http://127.0.0.1:9321/87654321`），支持 `${base}/api/config` 健康与令牌校验。
- **智能匹配与同剧延续绑定**：自动按片名、季/集及文件名匹配弹幕，支持手动搜索番剧与剧集绑定、同剧下一集自动延续匹配与时间轴偏移记忆。
- **防刷屏与高能热力曲线**：支持 3 秒窗口重复弹幕智能合并（`×N`）、多彩/纯白/屏蔽彩弹模式、字号/描边/透明度/最大行数/显示区域/滚动速度实时调节，以及进度条 **高能弹幕波峰热力曲线**。
- **21:9 宽银幕贴底布局**：可将宽银幕影片画面平滑下移贴底，腾出顶部黑边作为专属弹幕滑行区，避免遮挡字幕与人物。

### ⚡ 3. Rust 纯内存智能预加载与片头片尾跳过
- **按时长内存缓冲与下一集预加载**：支持按观影时长（默认 **5 分钟**，可调 1~30 分钟）配合安全内存上限（`256 MB ~ 2 GB`）动态控制 `libmpv` 缓存；本集接近尾声时由 Rust 在**纯内存中按 1 MiB 分块预加载下一集**（自动跳过片头区间，零磁盘临时文件），切集通过本机 HTTP/1.1 Range 服务微秒级秒开，稳定播放后自动释放内存块。
- **片头片尾跳过**：支持结合 Emby `Chapters`（`IntroStart`/`IntroEnd`）与手动打点的片头自动跳过，以及片尾 8 秒跳过倒计时轻提示（支持单集/整剧共享与多端同步）。

### 🔍 4. 多服务器跨服聚合搜索与媒体库管理
- **跨服联合穿透检索**：支持添加并管理多台 Emby / Jellyfin 服务器；聚合搜索并发查询全部已配置服务器，并自动按分类媒体库穿透检索管理员设置了“从全局搜索排除”的独立媒体库，点击跨服条目无感自动切换服务器上下文直连起播。
- **独立「继续观看与最近播放」页**：全服播放历史一站汇聚，严格过滤非视频内容，同一剧集多集自动折叠合并至最新观看集，并展现封面剧照、剧集总集数角标（`更新至 X 集` / `全 X 集`）及版本体积规格。

### 🔐 5. 端到端加密 (E2EE) 多端配置同步与本地备份
- **多协议云端/局域网同步**：
  - **WebDAV**（支持 `http://` 误连 HTTPS 端口返回 400 时自动升级 HTTPS、自签名证书兼容与自动 `MKCOL` 建目录）
  - **S3 对象存储**（AWS SigV4 签名，兼容 AWS S3、Cloudflare R2、MinIO、阿里云 OSS、腾讯云 COS）
  - **SMB 局域网共享**（Windows 原生 `WNetAddConnection2W` API 会话认证；macOS / Linux 挂载路径透明读写）
- **本地 JSON 备份 & 系统文件管理器联动**：支持导出/导入本地配置文件（可选脱敏密码/Token 及独立加密密码），导出后可直接唤起系统文件管理器或访达。
- **PBKDF2 + AES-256-GCM 端到端加密**：设置同步密钥后，所有服务器凭据、弹幕节点、剧集绑定、屏蔽词与片头片尾标记均在离开本机前强加密，云端仅保存密文，并支持多端双向智能合并（Smart Merge）。

### 🌐 6. 全栈代理架构与跨平台自动更新
- **严格遵循系统代理与跳过列表**：支持「跟随系统代理 / 手动 HTTP·SOCKS5 / 直连」三种模式，完整读取 Windows `ProxyOverride`、macOS `ExceptionsList` + `ExcludeSimpleHostnames`、Linux 与 `NO_PROXY`（支持 IPv4/IPv6 CIDR、通配符、`<local>` 与端口规则）；WebDAV、S3 与更新器跟随全局代理且不受单服 Emby 代理覆写影响。
- **SOCKS5 本地隧道桥 & `nocta-img` 海报代理**：为 `libmpv` 自动按需建立 Rust L4 `HTTP CONNECT → SOCKS5` 隧道桥；通过自定义 `nocta-img` URI Scheme 代理全站海报，彻底摆脱 WebView 与手动代理/自定义 `User-Agent` 脱节的问题；`.strm` 断流时自动执行 `diagnose_stream_url` 逐跳诊断并支持 Rust 透明 Range 中转。
- **应用内自动更新**：基于 `tauri-plugin-updater` 与内置 Ed25519 公钥强制验签，支持**正式版 (Stable)** / **预发布 (Pre-release)** 双通道、GitHub 下载加速镜像前缀及桌面端下载进度条与一键重启安装。

---

## 🛠️ 技术栈 (Tech Stack)

| 领域 | 核心技术 | 说明 |
| :--- | :--- | :--- |
| **桌面壳层与后端** | [Tauri 2.0](https://tauri.app/) + [Rust](https://www.rust-lang.org/) | 原生窗口穿透、纯内存预加载、L4 SOCKS5 隧道、图片代理、`WNet` SMB、自动更新 |
| **前端框架** | [React 19](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/) + React Router 7 | 强类型组件架构与客户端路由 |
| **构建工具** | [Vite 6](https://vitejs.dev/) + [pnpm](https://pnpm.io/) | 极速开发热更新与单一版本号注入 |
| **界面样式** | [TailwindCSS 3](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) | 暗色沉浸主题、毛玻璃 HUD 与自适应布局 |
| **状态与请求** | [Zustand 5](https://zustand-demo.pmnd.rs/) + TanStack Query 5 | 模块化持久化状态与统一代理请求层 |
| **播放内核** | [`libmpv`](https://mpv.io/) (`tauri-plugin-libmpv`) + HTML5 Video | GPU 硬件硬解、双层穿透、色调映射、外挂/双语字幕与音画调校 |
| **弹幕引擎** | [`wade6716/Danmaku`](https://github.com/wade6716/Danmaku) | 120Hz 高性能 Canvas 弹幕渲染器（支持显示区域、行数上限与防遮挡边距） |

---

## 🚀 快速上手 (Getting Started)

### 📦 直接下载安装包 (Pre-built Binaries)

前往 [GitHub Releases](https://github.com/wade6716/Nocta/releases) 下载对应系统与芯片架构的最新安装包：

| 操作系统与架构 | 安装包命名格式 | 说明 |
| :--- | :--- | :--- |
| **Windows (x64)** | `Nocta_*_windows_x64-setup.exe` | NSIS 一键安装程序（内置 `libmpv-2.dll`） |
| **macOS (Apple Silicon)** | `Nocta_*_macos_aarch64.dmg` | 原生适配 M1 / M2 / M3 / M4 等芯片 |
| **macOS (Intel)** | `Nocta_*_macos_x64.dmg` | 适配 Intel 处理器 Mac |
| **Linux (x64)** | `Nocta_*_linux_*.deb` | Debian / Ubuntu 发行版安装包 |

> [!TIP]
> **🍎 macOS 首次打开提示“已损坏，无法打开”或“无法验证开发者”？**
> 这是 macOS Gatekeeper 对未申请苹果公证的开源应用的常规拦截。
> 1. **终端一键解除隔离（最推荐）**：将 `Nocta.app` 拖入「应用程序」后，打开终端执行：
>    ```bash
>    sudo xattr -rd com.apple.quarantine /Applications/Nocta.app
>    ```
>    输入开机密码回车即可正常打开。
> 2. **系统设置放行**：前往「系统设置」->「隐私与安全性」，点击底部“已阻止使用 Nocta...”旁的「仍要打开」。

### 本地开发与编译

#### 前置环境
- [Node.js](https://nodejs.org/) (>= 20) & [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install) (Stable) 及系统 C/C++ 工具链（Windows 需 Visual Studio Build Tools；Linux 需 WebKitGTK/mpv 开发包；macOS 需 Xcode CLI Tools）

```bash
# 1. 克隆仓库
git clone https://github.com/wade6716/Nocta.git
cd Nocta

# 2. 安装前端依赖
pnpm install

# 3. 安装并同步 libmpv 动态库
# macOS 需先安装 Homebrew 版 mpv（Linux 可通过系统包管理器安装 libmpv-dev）
brew install mpv
pnpm setup-mpv

# 4. 启动桌面端开发调试环境
pnpm tauri dev
```

`src-tauri/lib/` 中的动态库因体积较大未纳入 Git。新克隆仓库后若尚未同步动态库，播放页会提示找不到 `libmpv-wrapper`。运行 `pnpm setup-mpv` 补齐后重启 `pnpm tauri dev` 即可。

```bash
# 仅构建前端与 TypeScript 类型校验
pnpm build

# 构建桌面端可执行文件与安装包（产物位于 src-tauri/target/release/bundle/）
pnpm tauri build
```

---

## ⚙️ 弹幕服务对接指南 (Danmu API Integration)

Nocta 作为纯 HTTP 客户端，可对接任何兼容标准弹弹play接口格式的弹幕聚合服务端（如 [danmu_api](https://github.com/huangxd-/danmu_api)）：

1. 进入「设置 -> 弹幕节点」或播放器右侧弹幕面板；
2. 点击 **添加节点**，在节点地址中填写服务 URL（若服务端启用了 Token，**请直接将 Token 写在 URL 路径末尾**）：
   - 本地节点：`http://127.0.0.1:9321/87654321`
   - 远程节点：`http://vps.example.com:9321/your_token`
3. 点击测试即可通过 `${base}/api/config` 探测服务连通性与实时延迟（ms）。

---

## ⌨️ 播放器快捷键与鼠标手势

| 模块 | 快捷键 / 手势 | 功能 |
| :--- | :--- | :--- |
| **播放与控制** | `Space` / `单击` | 播放 / 暂停 |
| | `←` / `→` | 快退 / 快进 5 秒 |
| | `长按 →` | 临时倍速快进，松手恢复 |
| | `↑` / `↓` / `滚轮` | 调节音量（±5%，最高 200% 软件增益） |
| | `Shift + 滚轮` | 精确微调进度（±5 秒） |
| | `M` / `[` `]` `\` | 静音开关 / 减速 / 加速 / 重置 1.0x |
| **弹幕与字幕** | `D` / `G` `H` | 开启隐藏弹幕 / 弹幕时间偏移 `-0.5s` `+0.5s` |
| | `C` / `A` / `Z` `X` | 轮换字幕 / 轮换音轨 / 字幕偏移 `-0.5s` `+0.5s` |
| | `拖放文件` / `,` `.` | 拖入本地 `.srt/.ass/.vtt` 外挂字幕 / 暂停逐帧步进 |
| **追番与视窗** | `L` / `P` `N` | 跳过片头 / 切换上一集 / 切换下一集 |
| | `T` / `S` / `I` | 窗口置顶 / 无损 PNG 截图 / 实时硬解与媒体遥测 HUD |
| | `F` / `双击` / `?` / `Esc` | 全屏切换 / 快捷键速查表 / 分层关闭浮层或返回 |

---

## 🎨 应用图标说明 (App Icons)

- 根目录的 [`app-icon.svg`](./app-icon.svg) 为应用矢量设计母版。
- 修改母版后执行以下命令，即可自动重新生成 Windows（`.ico`）、macOS（`.icns`）、各尺寸 PNG 与前端图标：
  ```bash
  pnpm tauri icon app-icon.svg
  ```

---

## 🤝 贡献指南 (Contributing)

欢迎提交 Issue 与 Pull Request 一起完善 Nocta！

1. Fork 本仓库并新建特性分支（如 `feat/amazing-feature`）；
2. 修改代码并确保 `pnpm build`（以及涉及 Rust 后端改动时的 `cargo test --manifest-path src-tauri/Cargo.toml`）全部通过；
3. 发起 Pull Request 说明您的改动背景与测试情况。

*提交规范参考 [Conventional Commits](https://www.conventionalcommits.org/)。*

---

## ⚠️ 免责声明 (Disclaimer)

本项目仅作为通用 **Emby / Jellyfin** 媒体库客户端与桌面播放器工具，用于个人技术学习、架构研究与日常软件交流。本项目不内置、不提供、不聚合、不分发任何影视媒体内容、媒体服务器地址、账号凭据或第三方弹幕源；所有媒体内容与数据均来源于用户自行连接或合法授权的自建/私有服务端，请遵守所在国家或地区的相关法律法规。

---

## 📄 开源许可证 (License)

本项目基于 [MIT License](LICENSE) 开源。
