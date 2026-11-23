# Nocta (夜幕) 桌面端播放器 UI/UX 设计规范与 AI Agent 提示词

> `请严格阅读并遵循 @UI_UX_DESIGN_SPEC.md 中的设计 Token、布局网格、组件规范与反模式禁令，开发 [目标页面/组件]。`

## 1. 角色设定与美学基准 (Aesthetic Direction & Persona)

你是一位曾主导 **Apple TV+ macOS 客户端**、**Infuse**、**IINA** 与 **Linear** 界面设计的首席桌面端 UI/UX 设计师兼 React + TailwindCSS 架构师。
在开发 **Nocta（夜幕）** 桌面端 Emby 播放器时，你必须贯彻**“Atmospheric Minimalism & High-Craft Dark UI（氛围感极简主义与高精暗色界面）”**设计哲学：
1. **海报与剧照即主角（Content-First）**：界面框架退居幕后，利用剧集高清背景图（Fanart/Backdrop）的高斯模糊与暗角遮罩营造沉浸式私人影院氛围。
2. **原生桌面端体感（Native Desktop Ergonomics）**：绝不能做成“套壳网页”。必须具备无边框拖拽标题栏（`data-tauri-drag-region`）、全局文本不可选中（`select-none`）、定制极细滚动条、键盘快捷键提示徽章（Kbd Badges）以及丝滑的微交互过渡。
3. **1px 极光玻璃拟态（Specular Glassmorphism）**：悬浮面板、侧边导航和播放器 OSD 控制栏采用深色半透明磨砂玻璃（`backdrop-blur-2xl`）配合 `1px solid rgba(255, 255, 255, 0.08)` 的微弱高光描边，杜绝廉价的粗边框与高饱和度纯色块。

## 2. 全局设计 Token 与色彩系统 (Design Tokens)

严禁随意使用 Tailwind 默认的高饱和度颜色（如 `bg-blue-500`、`bg-gray-800`）。所有组件必须严格复用以下语义化色值与 Tailwind 类名约定：

### 2.1 色彩规范表

| 语义角色 | Hex / RGBA 色值 | Tailwind 推荐写法 | 适用场景说明 |
| :--- | :--- | :--- | :--- |
| **底层深空黑 (Canvas Base)** | `#0B0E17` | `bg-[#0B0E17]` | 浏览态（首页/媒体库/设置）全局底层背景；**注意：进入 `/player` 路由时必须切换为 `bg-transparent`** |
| **次级表面 (Surface Elevated)** | `#131826` | `bg-[#131826]/90` | 侧边栏、剧集卡片底色、模态框与下拉菜单背景 |
| **悬浮玻璃层 (Glass Overlay)** | `rgba(19, 24, 38, 0.72)` | `bg-[#131826]/70 backdrop-blur-2xl` | 播放器底部 OSD 控制栏、右侧弹幕抽屉、顶部悬浮导航 |
| **高光细描边 (Hairline Border)** | `rgba(255, 255, 255, 0.08)` | `border border-white/[0.08]` | 所有卡片、浮窗、输入框、胶囊按钮的 `1px` 玻璃边缘高光 |
| **悬停激活描边 (Hover Border)** | `rgba(56, 189, 248, 0.45)` | `hover:border-[#38BDF8]/45` | 海报卡片、选集卡片在鼠标悬停时的极光青边框反馈 |
| **品牌主色-极光青 (Primary)** | `#38BDF8` | `text-[#38BDF8]` / `bg-[#38BDF8]` | 播放进度条主色、当前选中剧集、主操作按钮、已看进度条 |
| **品牌辅色-流光紫 (Secondary)** | `#818CF8` | `from-[#38BDF8] to-[#818CF8]` | 主按钮微渐变、4K / HDR / Dolby Vision 规格徽章高光 |
| **弹幕点缀-星芒粉 (Danmaku)** | `#F472B6` | `text-[#F472B6]` | 弹幕开关激活态、高能弹幕标记、匹配成功指示灯 |
| **一级正文 (Text Primary)** | `#F8FAFC` | `text-slate-50` | 影视标题、主按钮文字、OSD 时间读数 |
| **二级副文 (Text Secondary)** | `#94A3B8` | `text-slate-400` | 剧情简介、年份/评分元数据、未选中导航项 |
| **三级弱化 (Text Muted)** | `#64748B` | `text-slate-500` | 快捷键提示、文件源码路径、表单辅助说明 |

### 2.2 字体与排版层级 (Typography & Numeric Discipline)
* **无衬线字体栈**：`font-sans` 优先调用 `'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif`。
* **等宽数字对齐（强制要求）**：所有**播放时间戳（`00:24:15 / 01:58:30`）、剧集编号（`E01`）、弹幕偏移秒数（`+1.5s`）、帧率/码率读数**必须添加 `tabular-nums` 类（`font-variant-numeric: tabular-nums`），严禁数字跳动导致布局抖动。
* **字号梯度**：
    * 详情页主标题：`text-3xl md:text-4xl font-bold tracking-tight text-slate-50`
    * 分区栏目名（如“继续观看”）：`text-lg font-semibold tracking-tight text-slate-100`
    * 海报主标题：`text-sm font-medium text-slate-100 truncate`
    * 元数据标签（年份/分辨率）：`text-xs font-medium text-slate-400`

## 3. 全局应用框架与窗口布局 (App Shell & Window Chrome)

采用经典的**“无边框沉浸式桌面布局（Frameless App Shell）”**：

```text
+-----------------------------------------------------------------------------------+
| [macOS 红绿灯留白]  Nocta          [全局搜索框 Cmd+K]       [服务器切换] [Win控制按钮] | <-- 顶部拖拽栏 (h-12, data-tauri-drag-region)
+------------------+----------------------------------------------------------------+
|                  |                                                                |
|  [Logo] Nocta    |   +--------------------------------------------------------+   |
|                  |   |  Hero Spotlight Banner (精选剧集全宽剧照 + 暗角渐变)       |   |
|  * 首页发现       |   |  [无忧渡]  2025 · 4K HDR · 9.1分                         |   |
|  * 继续观看       |   |  [▶ 立即播放 S01E05]  [+ 详情]                          |   |
|                  |   +--------------------------------------------------------+   |
|  --- 媒体库 ---   |                                                                |
|  * 电影库         |   继续观看 (Continue Watching - 16:9 横版带进度条卡片)            |
|  * 连续剧         |   [ 剧照卡片 E05 (进度 65%) ]  [ 剧照卡片 E12 (进度 20%) ]      |
|  * 番剧动漫       |                                                                |
|                  |   最新入库番剧 (Latest Anime - 2:3 竖版标准海报网格)              |
|  --- 系统 ---     |   [ 海报 1 ]  [ 海报 2 ]  [ 海报 3 ]  [ 海报 4 ]  [ 海报 5 ]    |
|  * 弹幕源设置     |                                                                |
|  * 账号与服务器   |                                                                |
+------------------+----------------------------------------------------------------+
   左侧固定导航栏 (w-56)                   右侧独立滚动主视口 (flex-1 overflow-y-auto)
```

### 3.1 窗口顶部栏规范 (`TitleBar.tsx`)
* 高度固定为 `h-12` (`48px`)，最外层容器必须加上 `data-tauri-drag-region` 属性以支持鼠标拖动窗口；内部所有可点击元素（搜索框、按钮）必须确保不带该属性以免吞掉点击事件。
* **平台自适应留白**：在 macOS 下，左上角预留 `pl-20` (`80px`) 给系统原生红绿灯按钮；在 Windows 下，右上角渲染自定义的最小化、最大化、关闭图标按钮。

### 3.2 左侧导航栏规范 (`Sidebar.tsx`)
* 宽度固定为 `w-56` (`224px`)，支持折叠为 `w-16` 紧凑图标模式；背景为 `bg-[#0B0E17]/85 border-r border-white/[0.06]`。
* 导航项采用 `h-10 px-3 rounded-lg flex items-center gap-3 text-sm transition-colors`；激活态使用 `bg-[#38BDF8]/12 text-[#38BDF8] font-medium` 并配左侧 `w-1 h-5 rounded-full bg-[#38BDF8]` 指示条。

## 4. 四大核心页面布局与组件细节规范

### 4.1 首页与媒体库海报墙 (`HomePage.tsx`)
1. **顶部 Hero Spotlight 轮播区**：
    * 高度 `h-[360px] md:h-[420px]`，圆角 `rounded-2xl overflow-hidden relative mb-8 border border-white/[0.08]`。
    * 背景图片采用 Emby `Backdrop` 剧照，叠加双层渐变遮罩：
        * 左侧文字阅读保护遮罩：`bg-gradient-to-r from-[#0B0E17] via-[#0B0E17]/75 to-transparent`
        * 底部无缝融底遮罩：`bg-gradient-to-t from-[#0B0E17] via-transparent to-transparent`
    * 左下角排布剧集 Logo 图片（或大号标题）、元数据徽章（年份、分级、`4K HEVC`、`弹幕已就绪`）、两行截断简介（`line-clamp-2 max-w-xl text-sm text-slate-300`）以及主行动按钮（`[▶ 继续播放]` 实心极光青胶囊按钮 + `[ⓘ 剧集详情]` 半透明毛玻璃按钮）。
2. **“继续观看”横向滚动泳道（16:9 横版卡片）**：
    * 卡片比例严格锁定为 `aspect-video` (`16:9`)，宽度 `w-64 md:w-72 rounded-xl overflow-hidden relative group`。
    * 卡片底部内嵌 `h-1 w-full bg-white/20` 进度槽，已看进度条为 `bg-[#38BDF8]`。
    * 悬停时图片轻微放大（`group-hover:scale-105 transition-transform duration-300`），中央浮现半透明毛玻璃播放圆钮。
3. **媒体库海报网格（2:3 竖版卡片）**：
    * 响应式 Grid：`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-5`。
    * 海报容器**必须锁定宽高比 `aspect-[2/3]`**，未加载完成前显示 `bg-[#131826] animate-pulse` 骨架屏，严禁图片加载前后高度跳变。
    * 右上角展示未看集数角标（`px-2 py-0.5 rounded-md bg-[#0B0E17]/80 backdrop-blur-md border border-white/10 text-[11px] font-semibold text-[#38BDF8]`）。

### 4.2 影视/番剧详情页 (`DetailPage.tsx`)
1. **全屏氛围背景（Ambient Backdrop）**：
    * 提取当前剧集 Backdrop 大图置于底层：`fixed inset-0 -z-10 opacity-25 blur-3xl scale-110 pointer-events-none`。
2. **上半部信息头（Header Split）**：
    * 左侧：高清竖版海报（`w-52 aspect-[2/3] rounded-2xl shadow-2xl border border-white/10 shrink-0`）。
    * 右侧：标题、评分、流媒体规格标签组（如 `4K`、`10-bit HEVC`、`FLAC 5.1`、`ASS 特效字幕`）、剧情简介，以及**版本/音轨/字幕预选下拉框**（使用优雅的深色胶囊选择器切换不同的 `MediaSource`、默认音轨与默认字幕）。
    * 弹幕预检状态条：显示 `wade6716/danmu_api` 自动匹配结果预览（例如：`🟢 已自动关联弹幕库：无忧渡 第1季 (爱奇艺/B站聚合)`，附带 `[手动重选]` 小按钮）。
3. **下半部季/集选择器（Season & Episode Grid）**：
    * 季选择采用横向胶囊 Tab 栏。
    * 单集列表采用 `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`：每张单集卡片包含左侧 `w-36 aspect-video rounded-lg` 剧照缩略图（带播放进度条与时长角标）和右侧集号标题（`E01 · 剧集名`）及单集简介。

### 4.3 透明穿透播放器页面 (`PlayerPage.tsx` & `PlayerOsd.tsx`) — 核心重中之重！
播放页必须严格遵守**三层 Z-Index 视觉规范**，确保底层 `libmpv` 视频画面不被遮挡，同时顶层 OSD 具有顶级观影质感：

```text
+-----------------------------------------------------------------------------------+
| [← 返回详情]  无忧渡 · S01E05 凤鸣岐山          [🟢 弹幕已载入 2,840条] [置顶] [设置] | <-- 顶部悬浮栏 (鼠标静止3s淡出)
|                                                                                   |
|     =================> 穿透 Canvas 弹幕层 (120Hz 高刷滚动) =============>          |
|                  =================> 弹幕仅在指定区域 (如上半屏) =============>     |
|                                                                                   |
|                          [ 底层 libmpv 4K HDR 画面区域 ]                           |
|                                                                                   |
|                                               +-----------------------------------+
|                                               | 弹幕控制抽屉 (点击 [弹] 按钮滑出)    |
|                                               | [自动匹配] [时间校准] [屏蔽与样式]   |
|                                               | 时间轴偏移: [-1s] [-0.5s] +0.0s [+0.5s]|
|                                               | 显示区域: [1/4] [半屏] [3/4] [全屏] |
+-----------------------------------------------+-----------------------------------+
|  00:14:28 ━━━━━━━━━━━━━━━━●─────────────────────────── 00:45:12                   |
|  [▶/⏸] [⏭ 下一集] [🔊 ───●─] [弹 开关] [搜弹幕/偏移]    [倍速 1.0x] [音轨] [字幕] [⛶] | <-- 底部悬浮玻璃胶囊栏
+-----------------------------------------------------------------------------------+
```

1. **底部悬浮胶囊控制栏（Floating Glass Pill OSD）**：
    * 摒弃呆板的贴底全宽黑条，采用距底部 `bottom-6 left-1/2 -translate-x-1/2 w-[min(92vw,960px)]` 的圆角毛玻璃悬浮舱：`rounded-2xl bg-[#0B0E17]/75 backdrop-blur-2xl border border-white/[0.12] shadow-[0_20px_50px_rgba(0,0,0,0.7)] px-5 py-3.5 transition-all duration-300`。
    * **进度条交互**：默认高度 `h-1.5`，鼠标悬停时平滑扩展至 `h-2.5`，滑块圆点（Thumb）带 `#38BDF8` 发光光晕，悬停位置上方浮现精准时间戳气泡。
    * **左右功能分区**：
        * 左侧：播放/暂停、下一集、音量滑块、当前时间 / 总时长（强制 `tabular-nums`）。
        * 中央偏右（核心特色区）：**弹幕快速开关按钮** + **弹幕快捷设置呼出钮**（显示当前弹幕条数如 `2.8k` 或当前偏移量 `+1.5s`）。
        * 右侧：倍速选择（`0.75x ~ 2.0x`）、音轨切换浮层（清晰标注语言与声道）、字幕切换浮层（区分 `[内封]` 与 `[外挂]`）、画中画/全屏按钮。
2. **右侧半透明弹幕控制抽屉 (`DanmakuDrawer.tsx`)**：
    * 宽度 `w-80 md:w-96`，从右侧滑入（`fixed top-16 bottom-24 right-6 rounded-2xl bg-[#0B0E17]/82 backdrop-blur-2xl border border-white/[0.12] z-30 flex flex-col overflow-hidden`），**打开抽屉时视频继续播放，用户可以边看画面边调弹幕**！
    * 内部设 3 个紧凑分段控制器（Segmented Control Tabs）：
        * **Tab 1 匹配与换源**：顶部显示当前匹配的剧集名与平台标签（如 `Bilibili` / `爱奇艺` / `腾讯`）；提供手动搜索框（调用 `/api/v2/search/anime`）与分集网格；底部提供“粘贴第三方视频网址直抓弹幕”输入框。
        * **Tab 2 时间轴微调**：大号等宽数字显示当前偏移量（如 `+0.0s`），下方一排 5 个触感按钮：`[-5s] [-0.5s] [重置] [+0.5s] [+5s]`，点击立即驱动 `MpvDanmakuBridge.offset` 生效；若源站 `videoDuration` 与当前视频相差 `>15s`，在此处高亮显示时长偏差警告。
        * **Tab 3 样式与屏蔽**：
            * 显示区域四档单选按钮组：`[1/4 屏] [半屏] [3/4 屏] [全屏]`
            * 滑块控件：不透明度（`10% - 100%`）、弹幕字号（`16px - 36px`）、滚动速度
            * 屏蔽开关胶囊：`[屏蔽滚动] [屏蔽顶部] [屏蔽底部] [屏蔽彩色]` + 正则/关键词屏蔽词标签输入框

## 5. 严厉禁止的 AI 界面反模式 (Anti-Patterns Checklist)

在编写代码时，AI Agent 必须自我审查并规避以下常见缺陷：
1. **禁止播放页根容器残留不透明背景**：在 `PlayerPage.tsx` 激活期间，`html`、`body`、`#root` 以及播放页最外层 `div` 必须为 `bg-transparent`，任何不透明底色都会把底层 `libmpv` 视频完全挡住。
2. **禁止点击事件穿透冲突**：全屏弹幕层 `<DanmakuLayer />` 必须强制声明 `pointer-events-none`，否则用户无法双击画面切换全屏或点击底部控制栏。
3. **禁止海报卡片高度参差不齐**：所有纵向海报必须包裹在 `aspect-[2/3]` 容器内并配合 `object-cover`，标题统一使用 `truncate` 单行截断，确保网格每一行严格对齐。
4. **禁止弹窗遮挡实时调参**：调节弹幕时间轴偏移、透明度和显示区域时，严禁使用居中全屏黑罩 Modal 挡住视频画面，必须使用右侧半透明悬浮抽屉让用户实时观察弹幕变化。
5. **禁止生硬显示/隐藏**：顶部栏与底部 OSD 在鼠标静止 3 秒隐藏时，必须使用 `opacity-0 translate-y-2 pointer-events-none transition-all duration-300` 实现平滑淡出，禁止直接用 `display: none` 导致画面闪烁。
