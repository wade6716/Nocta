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

