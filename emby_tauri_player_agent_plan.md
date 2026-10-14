# Emby 桌面端播放器 AI Agent 开发执行计划 (Tauri 2 + React + TS + libmpv + Danmaku)

> **文档用途**：本文档是专为 AI Coding Agent（如 Claude Code、Cursor、Windsurf、Cline）编写的端到端工程架构与开发执行规范。请严格按照本文档定义的目录拓扑、技术栈约束、接口协议、分步实施计划及“避坑指南”推进代码编写与调试。

## 1. 项目总览与核心约束

### 1.1 项目目标
开发一款支持 **Windows (x64/ARM64)** 与 **macOS (Apple Silicon/Intel)** 的现代化轻量级 Emby 桌面端播放器，具备以下核心能力：
1. **Emby 媒体库浏览与直连播放**：对接 [Emby REST API](https://www.google.com/search?q=https%3A%2F%2Fdev.emby.media%2Fdoc%2Frestapi%2Findex.html)，实现多服务器登录、海报墙浏览、剧集选集、免转码直连播放（Direct Play，兼容 302 网盘直链）及播放进度实时回传。
2. **原生硬件解码内核**：底层集成 [MPV 播放器](https://www.google.com/search?q=https%3A%2F%2Fmpv.io%2F) 的核心库 [libmpv](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fmpv-player%2Fmpv%2Fblob%2Fmaster%2FDOCS%2Fman%2Flibmpv.rst)，开启 GPU 硬件加速（Windows D3D11VA / macOS VideoToolbox），支持 4K HEVC、10-bit HDR 色调映射、多音轨切换及内封/外挂 ASS 特效字幕渲染。
3. **内置高帧率弹幕系统**：
   * **弹幕 API 服务端**：对接自建/Fork 仓库 `https://github.com/wade6716/danmu_api`（基于 [huangxd-/danmu\_api](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fhuangxd-%2Fdanmu_api)，接口规范见 [danmu\_api 文档](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fhuangxd-%2Fdanmu_api%2Fblob%2Fmain%2FREADME.md)），支持起播自动匹配全网弹幕（爱优腾芒、B 站、巴哈姆特、弹弹Play 等）、手动搜番选集及粘贴视频网页直链加载弹幕。
   * **前端弹幕渲染库**：将自建/Fork 仓库 `https://github.com/wade6716/Danmaku`（基于 [weizhenye/Danmaku](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fweizhenye%2FDanmaku)，API 见 [Danmaku 中文文档](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fweizhenye%2FDanmaku%2Fwiki%2F%25E4%25B8%25AD%25E6%2596%2587%25E6%2596%2587%25E6%25A1%25A3)）克隆至独立目录同步修改调试，通过 Canvas 引擎叠加在透明 WebView 中间层，实现 60/120Hz 丝滑弹幕渲染。

### 1.2 技术栈选型表

| 模块层级 | 选型方案 | 关键依赖包 / 组件 |
| :--- | :--- | :--- |
| **桌面端跨平台框架** | [Tauri 2.0](https://www.google.com/search?q=https%3A%2F%2Fv2.tauri.app%2F) ([GitHub](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Ftauri-apps%2Ftauri)) | `tauri` v2, `@tauri-apps/api`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-store` |
| **前端视图与状态层** | React 19 + TypeScript + Vite | `react`, `react-dom`, `react-router-dom`, `zustand`, `@tanstack/react-query`, `tailwindcss`, `lucide-react` |
| **底层音视频播放内核** | Rust + [libmpv](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fmpv-player%2Fmpv) | Windows: [tauri-plugin-libmpv](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fnini22p%2Ftauri-plugin-libmpv) ([Crates.io](https://www.google.com/search?q=https%3A%2F%2Fcrates.io%2Fcrates%2Ftauri-plugin-libmpv))；macOS: `NSView` 子视图挂载 ([UniPlayer](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fxiaolai%2Funiplayer) 方案) 或 [libmpv2](https://www.google.com/search?q=https%3A%2F%2Fdocs.rs%2Flibmpv2) |
| **前端弹幕渲染引擎** | 本地独立仓库 `wade6716/Danmaku` | 通过 `pnpm` 本地软链 `link:../Danmaku` 引入，使用 Canvas 渲染引擎 |
| **弹幕聚合 API 服务** | 自建/本地 `wade6716/danmu_api` | 兼容弹弹Play v2 协议，支持 `/api/v2/match`、`/api/v2/search/anime`、`/api/v2/comment/:id` |

### 1.3 AI Agent 编码铁律（严禁违反）
1. **严禁使用 HTML5 `<video>` 标签播放 Emby 视频流**：浏览器原生 `<video>` 无法直接解码 MKV 容器、HEVC 10-bit、TrueHD/DTS 音频及内封 ASS 字幕。所有视频播放必须交由底层 `libmpv` 处理。
2. **严禁使用浏览器原生 `fetch` / `axios` 直接请求外部接口**：Emby 服务器与自建 `danmu_api` 往往未配置浏览器 CORS 响应头，所有 HTTP 请求必须统一封装并通过 Tauri 官方的 `@tauri-apps/plugin-http`（Rust 侧网络栈）发起，彻底规避跨域拦截。
3. **严格遵循 Emby 时间单位换算**：Emby 的时间单位 `Ticks` 为 **1 秒 = 10,000,000 Ticks**（100 纳秒），且接口要求必须为**整数**。上报进度时必须执行 `Math.round(seconds * 10_000_000)`，严禁传入浮点数。
4. **保持 `../Danmaku` 仓库构建产物同步**：在修改独立目录 `../Danmaku` 的源码时，确保配置好 Vite 源码别名（Alias）或 `rollup -w` 监听编译，使 React 前端能实时热更新调试弹幕库。

## 2. 多仓库工作区拓扑与环境初始化

### 2.1 推荐本地目录结构
请将主工程与 `Danmaku`（以及可选本地调试的 `danmu_api`）放置在同一父级工作目录下：

```text
workspace-root/
├── Danmaku/                          # git clone https://github.com/wade6716/Danmaku.git
│   ├── src/                          # Danmaku 核心源码（在此同步修改调试）
│   ├── types/                        # TypeScript 类型声明文件
│   └── package.json
├── danmu_api/                        # [可选本地运行] git clone https://github.com/wade6716/danmu_api.git
└── emby-tauri-player/                # Tauri 2 + React + TS 主工程
    ├── src/
    │   ├── api/
    │   │   ├── http.ts               # 基于 @tauri-apps/plugin-http 的统一请求客户端
    │   │   ├── embyClient.ts         # Emby 认证、媒体库、PlaybackInfo、进度回传封装
    │   │   └── danmuClient.ts        # 对接 wade6716/danmu_api 的全套接口与格式转换器
    │   ├── components/
    │   │   ├── layout/               # 自定义无边框标题栏、侧边导航栏
    │   │   ├── media/                # 海报卡片 MediaCard、剧集列表 EpisodeGrid
    │   │   └── player/
    │   │       ├── MpvDanmakuBridge.ts # libmpv 到 Danmaku 的 120Hz 线性插值时钟桥接器
    │   │       ├── DanmakuLayer.tsx  # 封装 wade6716/Danmaku 的全屏透明 Canvas 组件
    │   │       ├── PlayerOsd.tsx     # 播放控制栏、音轨/字幕选择器、倍速与选集抽屉
    │   │       └── DanmakuDrawer.tsx # 弹幕手动搜番、平台切换、URL直抓、时间偏移与样式面板
    │   ├── stores/
    │   │   ├── useAuthStore.ts       # Emby 多服账号与 danmu_api 地址/Token 持久化
    │   │   └── usePlayerStore.ts     # 播放器实时状态、轨道列表、弹幕配置与单集偏移记忆
    │   └── pages/
    │       ├── LoginPage.tsx         # 服务器连接与登录页
    │       ├── HomePage.tsx          # 继续观看、最近入库、媒体库视图
    │       ├── DetailPage.tsx        # 电影/剧集详情、季集切换、MediaSource 选源
    │       └── PlayerPage.tsx        # 透明穿透播放页（底层 mpv + 中层 Danmaku + 顶层 OSD）
    ├── src-tauri/
    │   ├── lib/                      # 存放平台动态库 (libmpv-2.dll / libmpv.dylib)
    │   ├── src/
    │   │   ├── lib.rs                # 插件注册、透明窗口管理、全局快捷键
    │   │   └── mpv/                  # Windows & macOS 双端 libmpv 窗口挂载与 IPC 封装
    │   ├── capabilities/default.json # Tauri v2 权限声明（开放 http、window、store 权限）
    │   ├── Cargo.toml
    │   └── tauri.conf.json
    ├── vite.config.ts
    └── package.json
```

### 2.2 关联独立 `../Danmaku` 目录的 Vite 热更新配置（重要避坑）
> **⚠️ 踩坑点 1：修改 `../Danmaku` 源码后页面不生效**
> 如果仅用 `npm link` 或 `pnpm link ../Danmaku`，Vite 默认会将 `node_modules` 中的依赖预构建缓存在 `.vite/deps` 下，而且默认构建指向的是 `Danmaku/dist/` 下的打包文件。
> **最佳解法**：在 `emby-tauri-player/vite.config.ts` 中直接配置 `resolve.alias` 指向 `../Danmaku/src/index.js`（或对应的入口文件），并放行上级目录文件读取权限，实现修改 `../Danmaku` 源码时 React 界面毫秒级 HMR 热更新！

```typescript
// emby-tauri-player/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      // 允许 Vite 直接读取上级目录中的 ../Danmaku 源码
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 直接指向独立 clone 的 Danmaku 源码入口，实现零编译等待的同步热更新调试
      'danmaku': path.resolve(__dirname, '../Danmaku/src/index.js'),
    },
  },
  optimizeDeps: {
    // 禁止 Vite 预构建缓存 danmaku，确保每次修改源码立即生效
    exclude: ['danmaku'],
  },
});
```

## 3. Phase 1：改造独立仓库 `wade6716/Danmaku`

原版 [weizhenye/Danmaku](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fweizhenye%2FDanmaku) 是为浏览器 HTML5 `<video>` 设计的。在 `../Danmaku` 目录中，Agent 需要优先完成以下 4 项桌面端专属升级：

### 3.1 解耦 `<video>` DOM，支持虚拟媒体对象 (`MpvMediaBridge`)
* **现状问题**：原版 `Danmaku` 初始化传入 `media` 时，内部依赖 `media.currentTime`、`media.paused`、`media.playbackRate` 以及 `addEventListener('play' | 'pause' | 'waiting' | 'playing' | 'seeking' | 'ratechange')`。而在 `libmpv` 架构中不存在 `<video>` 元素。
* **改造指令**：
  1. 检查 `../Danmaku/src/` 中对 `this.media` 的校验逻辑，确保它不強制执行 `media instanceof HTMLMediaElement` 检查，只要对象具备 `currentTime`、`paused`、`playbackRate` 属性和 `addEventListener` / `removeEventListener` 方法（即继承自标准 `EventTarget`）即可进入 Media 模式。
  2. 更新 `../Danmaku/types/index.d.ts`，新增 `DanmakuMediaAdapter` 接口定义：
     ```typescript
     export interface DanmakuMediaAdapter extends EventTarget {
       readonly currentTime: number;
       readonly paused: boolean;
       readonly playbackRate: number;
     }
     ```
     并将 `DanmakuOptions.media` 的类型扩展为 `HTMLMediaElement | DanmakuMediaAdapter`。

### 3.2 修复高分屏（macOS Retina / Windows 4K 缩放）Canvas 文字模糊
> **⚠️ 踩坑点 2：高分屏下 Canvas 弹幕严重发虚**
> 原版 Canvas 引擎在创建主舞台 `<canvas>` 和单条弹幕缓存 `<canvas>` 时，直接将 `canvas.width` 设为 CSS 逻辑像素宽高。在 macOS Retina (`devicePixelRatio = 2`) 或 Windows 4K 150%/200% 缩放下，Canvas 会被系统强行拉伸，导致文字边缘锯齿与模糊。

* **改造指令**：
  1. 在 `../Danmaku/src/engine/canvas.js`（及离屏单条弹幕 Canvas 创建处）引入物理像素倍率 `const dpr = window.devicePixelRatio || 1;`。
  2. 设置舞台尺寸时：
     ```javascript
     stage.width = this.width * dpr;
     stage.height = this.height * dpr;
     stage.style.width = `${this.width}px`;
     stage.style.height = `${this.height}px`;
     stage.context.scale(dpr, dpr);
     ```
  3. 生成单条弹幕离屏 `<canvas>` 纹理时，同样将 `canvas.width = comment.width * dpr`、`canvas.height = comment.height * dpr`，执行 `ctx.scale(dpr, dpr)` 绘制文字，最后在主舞台 `drawImage(commentCanvas, x, y, comment.width, comment.height)` 时按逻辑宽高绘制，确保高分屏下字迹如原生矢量般锐利。

### 3.3 新增显示区域限制 (`area`) 与底部字幕避让区 (`bottomMargin`)
* **现状问题**：原版轨道分配算法默认使用整个容器高度 `this.height`，满屏弹幕会遮挡视频主体及底部 Emby 字幕。
* **改造指令**：
  1. 在 `Danmaku` 实例属性中新增 `area`（默认 `1.0`，可选 `0.25 | 0.5 | 0.75 | 1.0`）和 `bottomMargin`（默认 `48`，单位 px，用于避让底部字幕）。
  2. 在轨道分配函数（计算弹幕 `y` 坐标处）修改可用高度计算：
     * 对于 `rtl` / `ltr`（滚动弹幕）和 `top`（顶部弹幕）：最大可用高度为 `const maxValidY = (this.height - this.bottomMargin) * this.area;`。当轨道 `y + comment.height > maxValidY` 时，若开启了防重叠则丢弃或覆盖最早轨道，严禁越界到下半屏。
     * 对于 `bottom`（底部弹幕）：起始基准线从 `this.height - this.bottomMargin` 向上堆叠。

### 3.4 新增全局透明度 (`opacity`) 与时间轴偏移 (`offset`)
* **改造指令**：
  1. 支持 `danmaku.opacity = 0.8`，在主舞台 Canvas 每一帧渲染循环开头设置 `stage.context.globalAlpha = this._opacity;`。
  2. 支持 `danmaku.offset = 0`（单位：秒，正数代表弹幕提前出现，负数代表弹幕延后出现），支持动态修改并立即触发内部轨道重置。

## 4. Phase 2：Tauri 2 + `libmpv` 双端透明穿透渲染实现

### 4.1 三层视觉穿透架构原理（Window Punch-through）
为了同时获得 `libmpv` 的全能硬解与 Web 前端的丝滑弹幕/UI，播放器采用三层垂直叠加结构：
1. **底层（Z-Index 0，Native 层）**：`libmpv` 渲染视图，直接由 GPU 输出解码画面（`vo=gpu-next`、`hwdec=auto-safe`）。
2. **中层（Z-Index 10，WebView Canvas 层）**：Tauri WebView 开启透明背景，全屏 `<div className="pointer-events-none fixed inset-0 z-10">` 挂载 `wade6716/Danmaku` 的 Canvas 舞台。
3. **顶层（Z-Index 20，WebView DOM 层）**：React 编写的播放器顶部返回栏、底部进度条、音量/倍速控件及右侧选集/弹幕设置抽屉。

### 4.2 Tauri 窗口透明与权限配置
在 `src-tauri/tauri.conf.json` 中必须开启窗口透明与 macOS 私有透明 API：

```json
{
  "app": {
    "macOSPrivateApi": true,
    "windows": [
      {
        "label": "main",
        "title": "Emby Player",
        "width": 1280,
        "height": 800,
        "minWidth": 960,
        "minHeight": 600,
        "transparent": true,
        "decorations": true
      }
    ]
  },
  "bundle": {
    "active": true,
    "resources": ["lib/**/*"]
  }
}
```

> **⚠️ 踩坑点 3：macOS 下 `macOSPrivateApi: true` 缺失导致黑屏**
> 在 Tauri 2 中，如果不显式开启 `"macOSPrivateApi": true`，macOS 的 `WKWebView` 即使设置了 `"transparent": true` 也会保留一层系统默认的不透明底色，导致底层的 `libmpv` 画面完全被遮挡！

### 4.3 Windows 与 macOS 双端 `libmpv` 挂载实现
> **⚠️ 踩坑点 4：macOS 官方原版 `libmpv` 不支持 `--wid` 窗口句柄嵌入**
> * **Windows 端**：可以直接集成 [tauri-plugin-libmpv](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fnini22p%2Ftauri-plugin-libmpv)，将 `libmpv-2.dll` 和 `libmpv-wrapper.dll` 放入 `src-tauri/lib/`。Windows 版 `libmpv` 原生支持 `--wid`，插件会自动创建透明 WebView 下层的子窗口完成挂载。
> * **macOS 端致命陷阱**：上游原版 `libmpv` 的 macOS Cocoa 后端**根本没有实现 `--wid` 参数**！如果在 macOS 上直接传窗口句柄给原版 `libmpv`，它会无视句柄并弹出一个脱离 Tauri 的独立 mpv 窗口。
> * **macOS 解决方案**：
>   * **方案 A（推荐，直接复用成熟补丁与挂载代码）**：参考开源项目 [UniPlayer](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fxiaolai%2Funiplayer)（基于 Tauri 2 + `libmpv` 的 macOS/Windows 播放器），复用其 `patches/` 目录下的 macOS `--wid` 补丁版 `libmpv.dylib` 及其 `src-tauri/src/macos_*.rs` 中的 `NSView` 层级编排逻辑——将 `libmpv` 的渲染 `NSView` 作为 `NSWindow.contentView` 的底层子视图插入（`NSWindowOrderingMode::NSWindowBelow`），排在 Tauri 的 `WKWebView` 下方。
>   * **方案 B（基于 `libmpv2` RenderContext API）**：在 Rust 端使用 [libmpv2](https://www.google.com/search?q=https%3A%2F%2Fdocs.rs%2Flibmpv2) crate 的 `RenderContext`，通过 OpenGL/Metal 回调将帧绘制到 `wgpu` / 原生子视图 Surface 上。

### 4.4 页面路由切换时的背景色状态机（防桌面穿透残影）
> **⚠️ 踩坑点 5：非播放页背景透明导致界面透过桌面壁纸**
> 开启 `transparent: true` 后，如果全局 CSS 写死 `body { background: transparent }`，用户在逛海报墙时也会看到背后的桌面图标。
> **正确做法**：
> 1. 全局默认样式设置 `html, body { background-color: #0f1115; color: #f3f4f6; }`。
> 2. 仅当进入 `/player/:itemId` 路由（`PlayerPage` 挂载时），在 `useEffect` 中执行：
>    ```typescript
>    document.documentElement.style.background = 'transparent';
>    document.body.style.background = 'transparent';
>    ```
> 3. 退出播放页（`useEffect` 清理函数）时，**必须先向 `libmpv` 发送 `stop` 命令隐藏视频层**，再将 `html, body` 背景恢复为 `#0f1115`。

## 5. Phase 3：Emby REST API 核心链路与避坑细节

### 5.1 统一鉴权请求头 (`X-Emby-Authorization`)
根据 [Emby API Key Authentication 规范](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2FMediaBrowser%2FEmby%2Fwiki%2FApi-Key-Authentication)，所有发往 Emby 的请求必须携带以下 Header（登录前不带 `Token` 与 `UserId`，登录后动态注入）：

```typescript
// src/api/embyClient.ts
export function buildEmbyHeaders(userId?: string, accessToken?: string): Record<string, string> {
  const deviceId = localStorage.getItem('emby_device_id') || crypto.randomUUID();
  localStorage.setItem('emby_device_id', deviceId);

  const authParts = [
    `Client="EmbyTauriPlayer"`,
    `Device="Desktop"`,
    `DeviceId="${deviceId}"`,
    `Version="0.1.0"`,
  ];
  if (userId) authParts.push(`UserId="${userId}"`);
  if (accessToken) authParts.push(`Token="${accessToken}"`);

  return {
    'Content-Type': 'application/json',
    'X-Emby-Authorization': `Emby ${authParts.join(', ')}`,
  };
}
```

### 5.2 核心接口清单与调用顺序
1. **用户登录**：`POST /emby/Users/AuthenticateByName`
   * 请求体：`{ Username: "xxx", Pw: "xxx" }`
   * 响应提取：`AccessToken`、`User.Id`、`ServerId`。
2. **获取媒体库分类**：`GET /emby/Users/{UserId}/Views`
3. **获取继续观看列表**：`GET /emby/Users/{UserId}/Items/Resume?Limit=12&Fields=PrimaryImageAspectRatio,BasicSyncInfo,MediaSources,Path`
4. **获取某季剧集列表**：`GET /emby/Shows/{SeriesId}/Episodes?SeasonId={SeasonId}&UserId={UserId}&Fields=Overview,MediaSources,Path`
5. **获取播放流信息（起播前必调）**：`POST /emby/Items/{ItemId}/PlaybackInfo?UserId={UserId}`
   * 请求体声明客户端支持全格式 Direct Play：
     ```json
     {
       "DeviceProfile": {
         "MaxStreamingBitrate": 200000000,
         "DirectPlayProfiles": [
           { "Container": "mkv,mp4,avi,mov,ts,m2ts,webm,flv", "Type": "Video" }
         ]
       },
       "EnableDirectPlay": true,
       "EnableDirectStream": true,
       "AllowVideoStreamCopy": true,
       "AllowAudioStreamCopy": true
     }
     ```
   * 从响应中提取：`PlaySessionId` 与 `MediaSources` 数组。
6. **构造免转码直连流地址（传给 `libmpv`）**：
   * 若 `mediaSource.IsRemote && mediaSource.Path` 为 HTTP 直链，直接使用 `mediaSource.Path`。
   * 否则拼接：`${serverUrl}/emby/Videos/${itemId}/stream.${mediaSource.Container || 'mkv'}?static=true&MediaSourceId=${mediaSource.Id}&PlaySessionId=${playSessionId}&api_key=${accessToken}`。
   * **注意**：`static=true` 参数至关重要，它强制 Emby Server 直接输出原始文件字节流（或返回 302 重定向到网盘直链），不触发任何服务端 FFmpeg 转码。

### 5.3 音轨与字幕轨索引映射（极易踩坑！）
> **⚠️ 踩坑点 6：Emby 的 `MediaStream.Index` 不等于 `libmpv` 的 `aid` / `sid`！**
> 在 Emby 返回的 `MediaSources[0].MediaStreams` 数组中，`Index` 是 FFmpeg 全局流索引（例如：`Index: 0` 是视频流，`Index: 1` 是日语配音，`Index: 2` 是国语配音，`Index: 3` 是简中内封字幕，`Index: 4` 是繁中内封字幕，`Index: 5` 是外挂 `.ass` 字幕）。
> 而在 `libmpv` 中，音轨 `aid` 和字幕轨 `sid` 是**按各自类型从 1 开始独立编号**的（即第一个字幕轨在 Emby 里 `Index` 是 `3`，但在 `libmpv` 里它的 `sid` 是 `1`！）。
> **正确映射算法**：
> * **内封音轨 (`Type === 'Audio'`)**：按其在 `MediaStreams` 中出现的先后顺序从 `1` 开始编号（第 1 条音轨对应 `mpv setProperty('aid', 1)`，第 2 条对应 `aid = 2`）。
> * **内封字幕 (`Type === 'Subtitle' && !IsExternal`)**：按内封字幕出现的先后顺序从 `1` 开始编号（第 1 条内封字幕对应 `sid = 1`）。
> * **外挂字幕 (`Type === 'Subtitle' && IsExternal`)**：拼接外挂字幕 URL：
>   `${serverUrl}/emby/Videos/${itemId}/${mediaSource.Id}/Subtitles/${stream.Index}/Stream.${stream.Codec || 'ass'}?api_key=${accessToken}`
>   然后调用 `libmpv` 命令：`command('sub-add', [externalSubUrl, 'select', stream.DisplayTitle || 'External'])`。

### 5.4 播放进度回传闭环
* **起播上报**：视频加载成功后立即调用 `POST /emby/Sessions/Playing`，携带 `{ ItemId, MediaSourceId, PlaySessionId, PositionTicks }`。
* **心跳与状态变更上报**：播放期间每 **10 秒**，以及发生暂停、恢复、Seek、切换音轨字幕时，调用 `POST /emby/Sessions/Playing/Progress`：
  ```json
  {
    "ItemId": "12345",
    "MediaSourceId": "abcd...",
    "PlaySessionId": "efgh...",
    "PositionTicks": 1425000000,
    "IsPaused": false,
    "EventName": "TimeUpdate"
  }
  ```
* **停止上报（切集或关闭播放器前必调）**：调用 `POST /emby/Sessions/Playing/Stopped`，携带当前最终的 `PositionTicks`。若漏调此接口，Emby 控制台会一直显示该设备处于播放中，且“继续观看”状态可能无法及时刷新。

## 6. Phase 4：`wade6716/danmu_api` 全链路对接与代码实现

根据 [danmu\_api 接口文档](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fhuangxd-%2Fdanmu_api%2Fblob%2Fmain%2FREADME.md)，封装完整的弹幕服务与播放器桥接代码。

### 6.1 `src/api/danmuClient.ts`（对接 `wade6716/danmu_api`）

```typescript
// src/api/danmuClient.ts
import { fetch } from '@tauri-apps/plugin-http';

export interface DanmuConfig {
  baseUrl: string;         // 例如 "http://127.0.0.1:9321" 或 "https://your-danmu.vercel.app"
  token?: string;          // 默认 "87654321"
  preferredPlatform?: string; // 可选偏好平台后缀，如 "bilibili1" | "qiyi" | "qq" | "youku" | "bahamut"
}

export interface RawDanmuComment {
  cid: number;
  p: string; // "出现秒数,模式(1滚动/4底部/5顶部),字号,十进制颜色,时间戳,弹幕池,用户Hash,弹幕ID"
  m: string; // 弹幕正文
}

export interface DanmuCommentResponse {
  count: number;
  comments: RawDanmuComment[];
  videoDuration?: number; // 当请求带 duration=true 时返回源站视频时长（秒）
}

export interfaceFormattedDanmakuItem {
  text: string;
  time: number;
  mode: 'rtl' | 'ltr' | 'top' | 'bottom';
  style: {
    font: string;
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    textBaseline: CanvasTextBaseline;
  };
}

// 规范化拼接带 Token 的 API 路径
function buildEndpoint(config: DanmuConfig, path: string): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  const tokenSegment = config.token ? `/${config.token.replace(/^\/+|\/+$/g, '')}` : '';
  // 若用户填的 baseUrl 已经包含 token，避免重复拼接
  if (config.token && base.endsWith(`/${config.token}`)) {
    return `${base}${path}`;
  }
  return `${base}${tokenSegment}${path}`;
}

/**
 * 1. 自动匹配剧集弹幕 ID (POST /api/v2/match)
 * 支持传入如 "无忧渡 S01E01 @qiyi" 或原始文件名
 */
export async function autoMatchEpisode(
  config: DanmuConfig,
  params: {
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    fileName?: string;
  }
): Promise<{ episodeId: number | string; animeTitle?: string; episodeTitle?: string } | null> {
  let queryName = params.fileName || '';
  if (params.seriesName && params.episodeNumber !== undefined) {
    const s = String(params.seasonNumber ?? 1).padStart(2, '0');
    const e = String(params.episodeNumber).padStart(2, '0');
    queryName = `${params.seriesName} S${s}E${e}`;
  }
  if (config.preferredPlatform) {
    queryName = `${queryName} @${config.preferredPlatform}`;
  }

  const url = buildEndpoint(config, '/api/v2/match');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: queryName.trim() }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data?.isMatched && data?.matches?.length > 0) {
    const best = data.matches[0];
    return {
      episodeId: best.episodeId,
      animeTitle: best.animeTitle,
      episodeTitle: best.episodeTitle,
    };
  }
  return null;
}

/**
 * 2. 手动按关键词搜索影视/番剧 (GET /api/v2/search/anime?keyword=...)
 */
export async function searchDanmuAnime(config: DanmuConfig, keyword: string) {
  const url = buildEndpoint(
    config,
    `/api/v2/search/anime?keyword=${encodeURIComponent(keyword)}`
  );
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

/**
 * 3. 获取指定番剧的分集列表 (GET /api/v2/bangumi/:animeId)
 */
export async function getDanmuBangumiEpisodes(config: DanmuConfig, animeId: string | number) {
  const url = buildEndpoint(config, `/api/v2/bangumi/${animeId}`);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Get bangumi failed: ${res.status}`);
  return res.json();
}

/**
 * 4. 根据 commentId 拉取弹幕列表并附带源站视频时长 (GET /api/v2/comment/:id?format=json&duration=true)
 */
export async function fetchCommentsById(
  config: DanmuConfig,
  commentId: string | number
): Promise<DanmuCommentResponse> {
  const url = buildEndpoint(
    config,
    `/api/v2/comment/${commentId}?format=json&duration=true`
  );
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Fetch comments failed: ${res.status}`);
  return res.json();
}

/**
 * 5. 通过第三方视频网页链接直接获取弹幕 (GET /api/v2/comment?url=...&format=json)
 * 支持空格分隔多链接合并，或尾部带 @-10 时间偏移
 */
export async function fetchCommentsByVideoUrl(
  config: DanmuConfig,
  videoPageUrl: string
): Promise<DanmuCommentResponse> {
  const url = buildEndpoint(
    config,
    `/api/v2/comment?url=${encodeURIComponent(videoPageUrl)}&format=json`
  );
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Fetch URL comments failed: ${res.status}`);
  return res.json();
}

/**
 * 6. 将 danmu_api 的返回体转换为 wade6716/Danmaku 的 Canvas 渲染格式
 */
export function transformToDanmakuItems(
  rawComments: RawDanmuComment[],
  options: {
    fontSize?: number;
    fontFamily?: string;
    blockScroll?: boolean;
    blockTop?: boolean;
    blockBottom?: boolean;
    blockColor?: boolean;
    blockedWords?: (string | RegExp)[];
  } = {}
): FormattedDanmakuItem[] {
  const {
    fontSize = 24,
    fontFamily = '"PingFang SC", "Microsoft YaHei", sans-serif',
    blockScroll = false,
    blockTop = false,
    blockBottom = false,
    blockColor = false,
    blockedWords = [],
  } = options;

  const result: FormattedDanmakuItem[] = [];

  for (const item of rawComments) {
    if (!item.m || !item.p) continue;

    // 客户端屏蔽词过滤
    const isBlocked = blockedWords.some((rule) =>
      typeof rule === 'string' ? item.m.includes(rule) : rule.test(item.m)
    );
    if (isBlocked) continue;

    const parts = item.p.split(',');
    const time = parseFloat(parts[0]) || 0;
    const rawType = parseInt(parts[1], 10);
    const decimalColor = parseInt(parts[3], 10) || 16777215;

    const mode: FormattedDanmakuItem['mode'] =
      rawType === 4 ? 'bottom' : rawType === 5 ? 'top' : 'rtl';

    if (mode === 'rtl' && blockScroll) continue;
    if (mode === 'top' && blockTop) continue;
    if (mode === 'bottom' && blockBottom) continue;
    if (blockColor && decimalColor !== 16777215) continue;

    const hexColor = `#${decimalColor.toString(16).padStart(6, '0')}`;

    result.push({
      text: item.m,
      time,
      mode,
      style: {
        font: `bold ${fontSize}px ${fontFamily}`,
        fillStyle: hexColor,
        strokeStyle: 'rgba(0, 0, 0, 0.85)',
        lineWidth: 2.5,
        textBaseline: 'bottom',
      },
    });
  }

  return result.sort((a, b) => a.time - b.time);
}
```

### 6.2 `src/components/player/MpvDanmakuBridge.ts`（120Hz 高刷插值桥接器）

> **⚠️ 踩坑点 7：直接用 `libmpv` 的 `time-pos` 驱动弹幕会导致画面一卡一卡**
> `libmpv` 的 `time-pos` 属性变化事件通过 IPC 传到前端通常间隔 50ms~200ms（约 5~20 次/秒），而 `wade6716/Danmaku` 的 `requestAnimationFrame` 每秒读取 `media.currentTime` 60~120 次。如果 `currentTime` 只返回最近一次 IPC 推送的静态值，弹幕会在多帧内原地踏步然后突然跳跃！
> **正确做法**：以 `libmpv` 的 `time-pos` 作为基准锚点，帧间用 `(performance.now() - lastSyncPerf) / 1000 * playbackRate` 进行高精度线性插值。

```typescript
// src/components/player/MpvDanmakuBridge.ts
export class MpvDanmakuBridge extends EventTarget {
  private _baseTime = 0;
  private _lastSyncPerf = performance.now();
  private _paused = true;
  private _playbackRate = 1.0;
  private _offset = 0; // 弹幕时间偏移（秒），正值提前，负值延后

  get currentTime(): number {
    if (this._paused) {
      return Math.max(0, this._baseTime + this._offset);
    }
    const elapsed = ((performance.now() - this._lastSyncPerf) / 1000) * this._playbackRate;
    return Math.max(0, this._baseTime + elapsed + this._offset);
  }

  get paused(): boolean {
    return this._paused;
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  get offset(): number {
    return this._offset;
  }

  set offset(seconds: number) {
    this._offset = seconds;
    // 触发 seeking 让 wade6716/Danmaku 重新定位弹幕游标
    this.dispatchEvent(new Event('seeking'));
  }

  /** 当收到 libmpv 的 time-pos 更新时调用 */
  onMpvTimePos(mpvSeconds: number | null) {
    if (mpvSeconds === null || Number.isNaN(mpvSeconds)) return;
    const predictedPureTime = this.currentTime - this._offset;
    const drift = Math.abs(mpvSeconds - predictedPureTime);

    this._baseTime = mpvSeconds;
    this._lastSyncPerf = performance.now();

    // 当时间跳变超过 0.75 秒（用户拖动了进度条或章节跳转），通知 Danmaku 重置舞台
    if (drift > 0.75) {
      this.dispatchEvent(new Event('seeking'));
    }
  }

  /** 当收到 libmpv 的 pause 或 core-idle (缓冲等待) 状态变化时调用 */
  onMpvPauseChange(isPausedOrBuffering: boolean) {
    if (this._paused === isPausedOrBuffering) return;
    this._baseTime = this.currentTime - this._offset;
    this._lastSyncPerf = performance.now();
    this._paused = isPausedOrBuffering;
    this.dispatchEvent(new Event(isPausedOrBuffering ? 'pause' : 'play'));
  }

  /** 当收到 libmpv 的 speed 倍速变化时调用 */
  onMpvSpeedChange(speed: number) {
    if (speed <= 0 || this._playbackRate === speed) return;
    this._baseTime = this.currentTime - this._offset;
    this._lastSyncPerf = performance.now();
    this._playbackRate = speed;
    this.dispatchEvent(new Event('ratechange'));
  }
}
```

### 6.3 `src/components/player/DanmakuLayer.tsx`（React 弹幕图层组件）

```tsx
// src/components/player/DanmakuLayer.tsx
import React, { useEffect, useRef } from 'react';
import Danmaku from 'danmaku';
import { MpvDanmakuBridge } from './MpvDanmakuBridge';
import { FormattedDanmakuItem } from '@/api/danmuClient';

interface DanmakuLayerProps {
  bridge: MpvDanmakuBridge;
  comments: FormattedDanmakuItem[];
  visible: boolean;
  speed?: number;       // 默认 144
  opacity?: number;     // 0.1 ~ 1.0
  area?: number;        // 0.25 | 0.5 | 0.75 | 1.0 (依赖 Phase 1 对 ../Danmaku 的扩展)
}

export const DanmakuLayer: React.FC<DanmakuLayerProps> = ({
  bridge,
  comments,
  visible,
  speed = 144,
  opacity = 0.85,
  area = 0.75,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const danmakuInstanceRef = useRef<any>(null);

  // 初始化与重建弹幕实例（当切换剧集或重选弹幕池时）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = new Danmaku({
      container,
      media: bridge as unknown as HTMLMediaElement,
      comments,
      engine: 'canvas',
      speed,
    });

    // 应用在 ../Danmaku 中扩展的桌面端专属属性
    if ('area' in instance) instance.area = area;
    if ('opacity' in instance) instance.opacity = opacity;
    if (!visible) instance.hide();

    danmakuInstanceRef.current = instance;

    // 监听窗口尺寸与全屏变化，自动调整 Canvas 舞台尺寸
    const resizeObserver = new ResizeObserver(() => {
      instance.resize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      instance.destroy();
      danmakuInstanceRef.current = null;
    };
  }, [bridge, comments]);

  // 动态响应显隐切换
  useEffect(() => {
    const inst = danmakuInstanceRef.current;
    if (!inst) return;
    visible ? inst.show() : inst.hide();
  }, [visible]);

  // 动态响应速度与区域变更
  useEffect(() => {
    const inst = danmakuInstanceRef.current;
    if (!inst) return;
    inst.speed = speed;
    if ('area' in inst) {
      inst.area = area;
      inst.resize();
    }
  }, [speed, area]);

  return (
    <div
      ref={containerRef}
      style={{ opacity }}
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none"
    />
  );
};
```

## 7. 分阶段研发里程碑与 Agent 执行步骤

请 AI Agent 严格按照以下 5 个里程碑顺序开发，**每完成一个里程碑必须运行对应的验证检查**后再进入下一阶段：

### Milestone 1：工作区脚手架与 `../Danmaku` 改造验证
1. 初始化 `emby-tauri-player`（Tauri v2 + React + TypeScript + TailwindCSS），安装 `@tauri-apps/plugin-http`、`@tauri-apps/plugin-store`、`zustand`、`lucide-react`。
2. 配置 `vite.config.ts` 指向 `../Danmaku/src/index.js`。
3. 在 `../Danmaku` 中完成 **Phase 1** 的 4 项改造（`DanmakuMediaAdapter` 兼容、`devicePixelRatio` 高清 Canvas 缩放、`area` 区域限制、`offset` 偏移）。
4. **自检标准**：启动 `npm run dev`，在测试页用 `MpvDanmakuBridge` 模拟播放计时，验证滚动/顶部/底部弹幕在 Retina/4K 缩放下清晰无锯齿，且 `area = 0.5` 时弹幕严格限制在上半屏。

### Milestone 2：Emby 认证、多服管理与海报墙浏览
1. 封装 `src/api/embyClient.ts`，实现服务器连通性测试（`GET /emby/System/Info/Public`）、账号密码登录（`POST /emby/Users/AuthenticateByName`）及 `@tauri-apps/plugin-store` 持久化。
2. 实现首页视图（`HomePage.tsx`）：“继续观看（Resume）”、各媒体库（电影/剧集/动漫）最新入库横向滚动列表，所有海报 URL 必须追加 `?maxWidth=400&quality=85&format=webp`。
3. 实现详情页（`DetailPage.tsx`）：展示剧集背景图、简介、季（Season）切换 Tab、单集（Episode）卡片列表，支持在详情页预选视频版本（`MediaSource`）、默认音轨和字幕轨。
4. **自检标准**：能够成功登录真实 Emby 服务器，流畅浏览媒体库并进入剧集详情页查看分集与音轨字幕信息。

### Milestone 3：`libmpv` 双端透明穿透播放与 Emby 进度回传
1. 配置 `src-tauri/tauri.conf.json` 开启 `transparent: true` 与 `macOSPrivateApi: true`。
2. 接入 `libmpv`（Windows 配置 `libmpv-2.dll` + [tauri-plugin-libmpv](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fnini22p%2Ftauri-plugin-libmpv)，macOS 配置 `NSView` 底层子视图挂载），监听 `pause`、`core-idle`、`time-pos`、`duration`、`speed`、`track-list` 属性。
3. 实现 `PlayerPage.tsx` 与 `PlayerOsd.tsx`：
   * 进入播放页时将 `html, body` 背景设为 `transparent`，唤醒 `libmpv` 加载 Emby 直连流，并跳转到 `UserData.PlaybackPositionTicks / 10_000_000` 断点续播位置。
   * 实现音轨切换（按 `aid` 相对序号）、内封字幕切换（按 `sid` 相对序号）与外挂字幕 `sub-add` 挂载。
   * 实现起播（`/Sessions/Playing`）、10 秒定时心跳（`/Sessions/Playing/Progress`）和退出停止（`/Sessions/Playing/Stopped`）上报。
4. **自检标准**：点击剧集可在应用窗口内硬解直连播放 4K HEVC 视频，顶部/底部 React 控制栏正常悬浮在视频上方，暂停、拖动与退出后 Emby 网页端“继续观看”进度完全同步。

### Milestone 4：`wade6716/danmu_api` 对接与弹幕抽屉交互
1. 在设置页增加 `danmu_api` 配置项（服务地址 `baseUrl`、访问 `token`、默认偏好平台 `preferredPlatform`）。
2. 在 `PlayerPage.tsx` 起播时自动并行调用 `autoMatchEpisode` $\rightarrow$ `fetchCommentsById`，转换格式后灌入 `DanmakuLayer`。
3. 对比 `danmu_api` 返回的 `videoDuration` 与 Emby 视频总时长：若差值 `> 15s`，在右上角弹出非模态提示条“片源与弹幕源时长相差 XX 秒，建议微调弹幕时间偏移”。
4. 开发右侧 `DanmakuDrawer.tsx` 抽屉面板，包含三个 Tab：
   * **源匹配与选集**：手动输入关键词调用 `/api/v2/search/anime`，点击词条调用 `/api/v2/bangumi/:id` 切换具体集数；提供“粘贴爱优腾哔播放页网址直接加载弹幕”输入框（调用 `/api/v2/comment?url=...`）。
   * **时间轴校准**：提供 `-5s`、`-0.5s`、`重置(0s)`、`+0.5s`、`+5s` 快捷按钮（直接修改 `bridge.offset`，并按 Emby `ItemId` 将偏移量持久化到本地 Store）。
   * **弹幕样式与屏蔽**：调节显示区域（1/4、半屏、3/4、全屏）、不透明度（10%~100%）、字号（16px~36px）、弹幕速度、按位置/彩色屏蔽开关及自定义正则屏蔽词列表。
5. **自检标准**：播放剧集时自动匹配并飘出弹幕；暂停、拖动进度条、切换 1.5x/2.0x 倍速时弹幕严格同步；手动搜番换源与 `±0.5s` 偏移即时生效。

### Milestone 5：桌面端细节打磨与双端打包
1. **快捷键与窗口交互**：绑定全局播放页快捷键（`Space` 播放/暂停、`←/→` 快退/快进 5 秒、`↑/↓` 音量调节、`D` 键一键开关弹幕、`F` 或双击画面切换全屏、`Esc` 退出全屏）。
2. **鼠标静止自动隐藏**：在播放页监听 `mousemove`，静止满 3 秒且未打开侧边抽屉时，自动隐藏顶部栏、底部 OSD 控制栏并将鼠标指针设为 `cursor: none`。
3. **可选内置 `danmu_api` Sidecar**：支持将 `wade6716/danmu_api` 通过 Node SEA / `pkg` 打包为 Tauri Sidecar，在用户未填写外部弹幕服务器地址时自动在后台拉起本地 `127.0.0.1:9321` 实例。

## 8. 十大高频踩坑与排查速查表（Agent 必读）

| 序号 | 故障现象 | 根本原因 | 标准修复方案 |
| :--- | :--- | :--- | :--- |
| **1** | 修改 `../Danmaku` 代码后前端无变化 | Vite 缓存了 `node_modules/.vite/deps` 或引用了旧的 `dist/` 产物 | 在 `vite.config.ts` 中将 `danmaku` 别名直接指向 `../Danmaku/src/index.js`，并加入 `optimizeDeps.exclude: ['danmaku']` |
| **2** | 请求 Emby 或 `danmu_api` 报 CORS 错误 | 使用了浏览器原生 `window.fetch` 或 `axios` | 全部替换为 `import { fetch } from '@tauri-apps/plugin-http'`，并在 `src-tauri/capabilities/default.json` 中配置 `"http:default"` 及允许所有 URL (`"allow": [{ "url": "http://**" }, { "url": "https://**" }]`) |
| **3** | macOS 下视频黑屏，只听到声音且看到弹幕 | `tauri.conf.json` 未开启 `macOSPrivateApi: true` 或 `WKWebView` 底色未透明 | 开启 `"macOSPrivateApi": true`，并在 `PlayerPage` 挂载时将 `html, body, #root` 的 `background` 设为 `transparent` |
| **4** | macOS 下起播时弹出一个独立的 mpv 窗口 | 原版 macOS `libmpv` 未实现 `--wid` 参数 | 使用打过 `--wid` 补丁的 macOS `libmpv.dylib`（参考 [UniPlayer](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2Fxiaolai%2Funiplayer)）或通过 `NSWindow.contentView` 将 `libmpv` 视图插入 `WKWebView` 底层 |
| **5** | 弹幕在暂停时不停止，或缓冲转圈时弹幕继续飘 | 只监听了 `pause` 属性，未监听网络缓冲等待 `core-idle` 属性 | 在 `libmpv` 中同时观察 `pause` 与 `core-idle`，任一为 `true` 时均调用 `bridge.onMpvPauseChange(true)` 冻结弹幕 |
| **6** | 切换内封字幕时选错轨道或无反应 | 直接把 Emby `MediaStream.Index`（如 `3`）当成 `libmpv` 的 `sid` 传入 | 将 `MediaStreams` 过滤出 `Type === 'Subtitle' && !IsExternal`，取其在过滤后数组中的 `index + 1` 作为 `libmpv` 的 `sid` |
| **7** | Emby 进度上报返回 `400 Bad Request` | `PositionTicks` 传入了带小数点的浮点数（如 `12345678.5`） | 必须执行 `Math.round(currentTimeSeconds * 10_000_000)` 转换为整数 |
| **8** | 高刷屏（120Hz）下弹幕肉眼可见顿挫感 | 直接返回 `libmpv` 低频上报的 `time-pos` 给 `Danmaku` | 使用 `MpvDanmakuBridge` 基于 `performance.now()` 做帧间线性插值 |
| **9** | 全屏切换或窗口拉伸后弹幕位置错乱、字体变形 | 容器宽高变化后未通知 `wade6716/Danmaku` 重新计算舞台尺寸 | 使用 `ResizeObserver` 监听弹幕容器尺寸变化，实时调用 `danmaku.resize()` |
| **10** | 从播放页返回海报墙后，背景变成透明透出桌面 | 卸载 `PlayerPage` 时未清理 `html, body` 的 `transparent` 样式或未停止 `libmpv` | 在 `PlayerPage` 的 `useEffect` 清理函数中先调用 `mpv.command('stop')`，再将 `document.body.style.background` 恢复为深色主题背景 `#0f1115` |
