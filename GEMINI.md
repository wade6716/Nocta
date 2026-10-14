# Nocta (夜幕) · Agent Rules & Project Guide

欢迎协助开发 **Nocta · 夜幕**（原 Emby 客户端升级而来的暗色沉浸式私人影院播放器，支持全网弹幕匹配与彩色渲染）。

在开始任何新任务前，请务必先查阅项目完整上下文记忆文档：
👉 [MEMORY.md](file:///d:/wade/code/emby-tauri-player/MEMORY.md)

---

## 核心开发准则与不可违背的硬性约束 (Hard Rules)

1. **Git 提交身份约束**：
   - 必须使用配置的 GitHub 隐私邮箱提交：`59910348+wade6716@users.noreply.github.com`，用户名 `wade6716`。
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
