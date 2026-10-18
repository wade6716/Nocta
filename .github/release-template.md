## 📦 资产下载与系统支持

| 操作系统 | 适用架构 / 芯片类型 | 推荐下载文件 | 说明 |
| :--- | :--- | :--- | :--- |
| **Windows** | 64 位 Intel / AMD (`x64`) | `Nocta_*_windows_x64-setup.exe` | 推荐使用 NSIS 一键安装包 |
| **macOS (Apple Silicon)** | 苹果 M 系列芯片 (`M1` ~ `M4`) | `Nocta_*_macos_aarch64.dmg` | 针对 Apple Silicon 原生优化，运行极速省电 |
| **macOS (Intel)** | 苹果老款 Intel 芯片 (`x64`) | `Nocta_*_macos_x64.dmg` | 原生适配 Intel 处理器 Mac |
| **Linux** | 64 位 (`x64` / `amd64`) | `Nocta_*_linux_*.deb` | Debian / Ubuntu 体系系统安装包 (`.deb`) |

---

### 🍎 macOS 首次打开提示“已损坏”或“无法验证开发者”解决办法：
> 由于本项目暂未加入苹果高昂的年费开发者计划，macOS Gatekeeper 安全机制可能会拦截未签名应用并提示：*“Nocta.app 已损坏，无法打开。你应该将它移到废纸篓”* 或 *“无法打开 Nocta，因为无法验证开发者”*。

**解决方法（任选其一即可）**：
1. **【最推荐】终端一键修复**：
   将 `Nocta.app` 拖入系统的「应用程序 (Applications)」目录后，打开系统的「终端 (Terminal)」，粘贴并执行以下命令：
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/Nocta.app
   ```
   输入 Mac 开机密码后回车即可正常打开。
2. **系统设置放行**：
   双击提示拦截后，前往「系统设置」->「隐私与安全性」，滑动到底部安全性区域，找到 *“已阻止使用 Nocta...”* 提示，点击「仍要打开」并验证密码。
3. **右键快速打开**：
   在访达的「应用程序」目录中，按住 `Control` 键并右键点击 `Nocta.app` 图标，在菜单中选择「打开」，并在弹窗提示中点击「打开」。

---
