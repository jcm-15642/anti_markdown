# Anti Markdown

专为 **VS Code** 与 **Antigravity IDE** 打造的现代化 Markdown 实时渲染、原位编辑与 AI 协作扩展。

---

## 插件特色与核心功能

### 1. 实时渲染与原位双击编辑 (In-Place Live Editing)
- **所见即所得的原位编辑**：直接在渲染视图中双击任意文字块、段落或标题即可原地进入编辑状态，光标精准定位在鼠标点击位置；编辑完成后自动实时渲染并保存更改。
- **快捷切换源码与预览**：通过快捷键 `Ctrl+Alt+M`（Mac 为 `Cmd+Alt+M`）或编辑器右上角切换图标，可随时在 Anti Markdown 富文本视图与 VS Code 原始纯文本编辑器之间一键平滑切换。
- **可折叠目录大纲 (TOC Outline)**：自动提取全文标题层级，右上角点击“☰ 目录大纲”可随时展开或折叠大纲面板，支持一键点击平滑滚动跳转。

### 2. AI 实时修改审查与双向状态同步 (AI Diff Review & Dual-IDE Chat Sync)
- **原汁原味 IDE 审查交互**：当 AI（如 Antigravity / Claude Code / Codex / Copilot）编辑 Markdown 文档时，预览窗口直接呈现原生 IDE 级别的审查条：`✓ Accept | ✕ Reject | +X lines, -Y lines`。
- **全平台双向状态同步**：在 Markdown 渲染窗口中点击接受（Accept）或拒绝（Reject）后，不仅能采纳或还原修改，还会**自动双向同步触发 Antigravity IDE 与 VS Code 内置 Chat / Copilot 对话栏的审查状态**，消除对话栏中的挂起提示。
- **新增与修改内容绿色高亮**：被添加或修改的段落、标题、列表项以高辨识度的柔和绿色背景与左侧高亮绿条标注，差异一目了然。
- **删除内容清晰预览**：被 AI 移除的原有文字自动展示在可折叠的红色删除框中（红色删除线排版），便于对比变更。
- **段落级与全文级双模式审查**：
  - **段落级**：点击每个变更块上方的 `✓ Accept` / `✕ Reject` 或悬浮工具栏中的 `✓ 接受此段` / `✕ 还原此段`，仅采纳或还原当前段落；
  - **全文级**：通过顶部吸顶审查栏一键 `✓ 全部接受 (Accept All)` 或 `✕ 全部拒绝 (Reject All)`；
- **全键盘快捷键支持**：
  - `Alt+Enter`：接受修改；
  - `Alt+Shift+Backspace`：还原修改；
  - `Alt+J` / `Alt+K`：平滑滚动聚焦到下一处 / 上一处修改位置。

### 3. 全能 Markdown 扩展语法支持
- **内置 Mermaid 交互矢量图表**：
  - 原生支持 `flowchart` / `graph`（支持节点自定义颜色、形状与子图分组）、`sequenceDiagram`（时序图）、`erDiagram`（实体关系模型表）、`xychart-beta` 等常见图表；
  - 支持无损矢量缩放、平移与查看 DSL 源码。
- **LaTeX / KaTeX 数学公式**：
  - 支持 `$...$` 行内公式（如 `$E = mc^2$`）；
  - 支持 `$$...$$` 独立块级公式的高质量排版与实时渲染。
- **GitHub 风格 5 色 Alert 提示框**：
  - 完美支持 `> [!NOTE]`、`> [!TIP]`、`> [!IMPORTANT]`、`> [!WARNING]`、`> [!CAUTION]`。
- **Carousel 轮播多页卡片**：
  - 支持 ````carousel` 语法与 `<!-- slide -->` 标记，实现多幻灯片平滑切换交互。
- **源码高亮胶囊链接 (`file://` Pills)**：
  - 智能识别 `[utils.py](file:///path/to/utils.py#L10-L20)` 格式；
  - 点击胶囊直接在侧边栏编辑器打开对应文件，并高亮聚焦指定的代码行。

### 4. 独立平台选择与代码文件悬浮胶囊开关 (Decoupled Platforms & Capsule Switch)
- **顶栏专属控制面板**：
  - **预览划词平台**：在 Markdown 渲染窗口顶部菜单中独立勾选 `VS Code` / `Antigravity` / `Claude Code` / `Codex`，仅作用于 Markdown 渲染窗口中的划词操作；
  - **代码文件胶囊开关**：顶栏提供独立开关按钮（`[● 代码划词: 开 / 关]`），支持一键开启或完全关闭普通代码文件中的划词悬浮胶囊；
  - **代码文件平台菜单**：完全独立于预览窗口，自由配置常规代码文件中展示哪些 AI 平台，两者互不影响、各司其职。
- **全编辑器通用悬浮 AI 胶囊**：
  - 开启后，在任意代码编辑器（无论是 Markdown 源码还是 `.js`、`.ts`、`.py`、`.java`、`.go` 等常规代码文件）中选中文本时，自动唤起选区下方的悬浮胶囊；
  - 支持行范围指示（如 `L10-15`）与一键发送到选中平台；
  - 防遮挡与防断触优化：胶囊智能置于选区下方，绝不遮盖被选中代码；划选时稳定顺滑，慢速拖动不丢失。

### 5. 双引擎灵活切换
- **Anti Markdown Pro 引擎**：内置高性能独立富文本渲染器，支持即时原位编辑与多格式扩展。
- **原生内置视图一键切换**：支持随时一键无缝唤起 Antigravity IDE 官方原生 `antigravity.artifactEditor` (`jetski-artifact`) 查看效果。

---

## 快捷键与操作入口

| 功能说明 | 快捷键 / 操作方式 | 对应命令 ID |
| :--- | :--- | :--- |
| **切换 Markdown 源码 / Anti Markdown 预览** | `Ctrl+Alt+M`（Mac: `Cmd+Alt+M`）或点击编辑器右上角切换图标 | `antiMarkdown.switchEditor` |
| **侧边栏打开 Antigravity 原生内置预览** | `Ctrl+Alt+V`（Mac: `Cmd+Alt+V`）或点击编辑器右上角图标 | `antiMarkdown.openNativeArtifactToSide` |
| **侧边栏打开实时同步预览** | 点击编辑器右上角侧边预览图标 | `antiMarkdown.openPreviewToSide` |
| **在当前标签页用原生内置编辑器打开** | 资源管理器右键 `.md` 文件 -> `使用 Antigravity 原生内置编辑器打开` | `antiMarkdown.openNativeArtifact` |
| **使用 Anti Markdown 编辑器打开** | 资源管理器右键 `.md` 文件 -> `使用 Antigravity 增强型编辑器打开` | `antiMarkdown.openStandaloneViewer` |
| **选择打开方式 (`Open With...`)** | 资源管理器右键 `.md` 文件 -> `打开方式... (Open With...)` -> 选择 **Anti Markdown Editor (Pro)** | - |
| **配置默认打开方式** | 命令面板 (`Ctrl+Shift+P`) -> 输入 `Anti Markdown: 配置默认 Markdown 编辑器模式` | `antiMarkdown.toggleDefaultAssociation` |

---

## 配置项说明

可在 VS Code 设置 (`Ctrl+,`) 中搜索 `antiMarkdown` 进行个性化配置：

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `antiMarkdown.previewAiPlatforms` | `array` | `["vscode", "antigravity", "claude", "codex"]` | 预览渲染窗口中启用的 AI 发送平台列表 |
| `antiMarkdown.otherFilesCapsuleEnabled` | `boolean` | `true` | 是否在其他常规代码文件中启用选中文本浮动胶囊 |
| `antiMarkdown.otherFilesAiPlatforms` | `array` | `["vscode", "antigravity", "claude", "codex"]` | 其他常规代码文件的悬浮胶囊中启用的 AI 平台列表 |
| `antiMarkdown.showOutline` | `boolean` | `true` | 是否默认在侧边栏显示可折叠目录大纲 (TOC) |
| `antiMarkdown.showDiffReview` | `boolean` | `true` | 是否显示 AI 差异审查条与绿色高亮 |
| `antiMarkdown.engineMode` | `string` | `"standalone"` | 默认核心引擎模式（`"standalone"`: Anti Markdown Pro 增强版; `"native"`: Antigravity IDE 原生引擎） |

---

## 安装与使用 (Installation)

### 方式一：直接下载 VSIX 安装包（推荐）
1. 前往 GitHub Releases 页面下载安装包：
   - 👉 **[下载最新版本 anti-markdown-1.7.7.vsix](https://github.com/jcm-15642/anti_markdown/releases/download/v1.7.7/anti-markdown-1.7.7.vsix)**
   - 或在 [GitHub Releases 全部版本列表](https://github.com/jcm-15642/anti_markdown/releases) 中选择历史版本下载。
2. **在编辑器中安装**：
   - 打开 VS Code / Antigravity IDE 扩展面板 (`Ctrl+Shift+X` / `Cmd+Shift+X`)；
   - 点击右上角 `...` 菜单，选择 **从 VSIX 安装... (Install from VSIX...)**；
   - 选择下载好的 `anti-markdown-1.7.7.vsix` 即可完成安装。

### 方式二：命令行一键安装
下载 `.vsix` 文件后，在终端执行以下命令之一：
```bash
# VS Code
code --install-extension anti-markdown-1.7.7.vsix

# Antigravity IDE
agy --install-extension anti-markdown-1.7.7.vsix
```

### 方式三：从源码构建并安装
```bash
# 克隆仓库
git clone https://github.com/jcm-15642/anti_markdown.git
cd anti_markdown

# 执行检查与打包
npm test

# 安装生成的 vsix 包
code --install-extension anti-markdown-1.7.7.vsix
```
