# Antigravity Markdown Viewer (`antigravity-markdown-viewer`)

让任意项目中的 Markdown (`*.md`) 文档都能使用 **Antigravity IDE 内置 Artifact 编辑器**进行预览与交互的 VS Code / Antigravity 插件。

---

## 一、原理解析：为什么 `brain/` 下的 Markdown 使用内置编辑器，而项目中的 `.md` 没有？

在 Antigravity IDE 的内置插件 `google.google-antigravity`（位于 `extensions/agy/package.json`）中，官方注册了一个名为 **`antigravity.artifactEditor`**（显示名称为 **Antigravity Artifact Viewer**）的 Custom Editor，但它的 `selector` 被严格限制在了特定路径模式：

```json
"customEditors": [
  {
    "viewType": "antigravity.artifactEditor",
    "displayName": "Antigravity Artifact Viewer",
    "priority": "default",
    "selector": [
      { "filenamePattern": "antigravity:/**/*.md" },
      { "filenamePattern": "**/.gemini/*/brain/**/*.md" }
    ]
  }
]
```

因此：
1. **为什么 `/home/mazhao/.gemini/antigravity/brain/.../django_orm_complete_guide.md` 会自动使用内置编辑器？**
   因为它的路径匹配了 `**/.gemini/*/brain/**/*.md`，并且 Antigravity 在打开它时会将其 URI 转换为自定义协议 `jetski-artifact:///home/.../django_orm_complete_guide.md?cascadeId=<uuid>`，交由内置的 Jetski `ArtifactPage` 渲染。
2. **为什么项目中的 `.md` 文件点击“打开侧边栏预览”效果完全不一样？**
   因为普通项目路径不匹配 `**/.gemini/*/brain/**/*.md`，所以点击“打开侧边栏预览”调用的是 VS Code 原生自带的基础预览命令 `markdown.showPreviewToSide`（`vscode.markdown-language-features`），不支持 Antigravity 特有的 Artifact 顶栏、章节批注、`carousel` 轮播、`file://#L10-L20` 代码胶囊以及暗色主题下的 Mermaid 交互卡片。

---

## 二、本插件提供的双引擎解决方案

本插件同时提供 **原生内置桥接模式 (Native Bridge)** 与 **增强型独立编辑器模式 (Antigravity Artifact Viewer Pro)**：

### 模式 A：直接调用 Antigravity IDE 原生内置 `antigravity.artifactEditor` (`jetski-artifact:`)
插件深度适配了 `agy/vscode/extension.js` 中 `ArtifactEditorProvider` 的底层协议，自动将任意项目 `.md` 文件封装为 `jetski-artifact:` 协议 URI（自动清空 `authority` 以兼容 WSL Remote 环境，并自动挂载最近的 `cascadeId` 会话上下文），然后调用：
```js
vscode.commands.executeCommand('vscode.openWith', artifactUri, 'antigravity.artifactEditor', { ... });
```
从而实现 **100% 调用 Antigravity IDE 原生内置编辑器** 打开项目中的任意 `.md` 文件！

### 模式 B：Antigravity Artifact Viewer Pro (`antiMarkdown.artifactEditor`)
原生 `antigravity.artifactEditor` 虽然视觉效果好，但它只读取磁盘文件、不支持实时源码分栏编辑。因此本插件还内置了完整复刻 Antigravity 视觉与交互的增强型 Custom Editor：
- **三视图无缝切换**：`预览 (Preview)` / `分栏实时编辑 (Split)` / `源码 (Source)` + 可折叠 **目录大纲 (TOC Outline)**。
- **Mermaid 交互式图表**：内置支持 `flowchart`/`graph`（含 `subgraph`、自定义 `style` 颜色、多种节点形状）、`erDiagram`（实体属性表与关系连线）、`sequenceDiagram`、`xychart-beta`，支持缩放与查看 DSL 源码。
- **GitHub 风格 5 色高亮框**：完整支持 `[!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]`、`[!CAUTION]`。
- **Carousel 轮播卡片**：支持 ````carousel` 与 `<!-- slide -->` 多页切换。
- **源码胶囊链接 (`file://` Pills)**：点击 `[utils.py](file:///path/to/utils.py#L10-L20)` 直接在侧边打开对应源码并高亮选中 `L10-L20` 行。
- **LaTeX / KaTeX 数学公式**：支持 `$...$` 行内公式与 `$$...$$` 块级公式渲染。
- **章节批注 (Review Comments)**：悬停任意章节标题可点击 `+ 批注 (Review)` 生成结构化 Artifact 批注。
- **顶栏一键切原生**：预览界面右上角提供 **`✦ 原生内置视图 (jetski)`** 按钮，随时一键切换到官方原生视图。

---

## 三、快捷键与入口说明

| 功能入口 | 快捷键 / 操作方式 | 命令 ID |
| :--- | :--- | :--- |
| **侧边栏打开 Antigravity 原生内置预览** | `Ctrl+Alt+V`（或点击编辑器右上角图标） | `antiMarkdown.openNativeArtifactToSide` |
| **在当前标签页用 Antigravity 原生内置编辑器打开** | 资源管理器右键 `.md` 文件 -> 使用 Antigravity 原生内置编辑器打开 | `antiMarkdown.openNativeArtifact` |
| **侧边栏打开 Antigravity 实时同步预览 (Pro)** | 点击编辑器右上角分栏图标 | `antiMarkdown.openPreviewToSide` |
| **切换 Markdown 源码 / Antigravity 预览** | `Ctrl+Alt+M`（或点击编辑器右上角切换图标） | `antiMarkdown.switchEditor` |
| **配置默认打开方式 (`Pro` / `Native` / `源码`)** | 命令面板 `Ctrl+Shift+P` -> `Antigravity Markdown: 配置默认 Markdown 编辑器模式` | `antiMarkdown.toggleDefaultAssociation` |
| **选择打开方式 (`Reopen Editor With...`)** | 右键 `.md` 文件 -> `打开方式... (Open With...)` -> 选择 **Antigravity Artifact Viewer (Pro)** 或 **Antigravity Artifact Viewer** | - |

---

## 四、安装方法

在当前项目目录下已打包好可直接安装的 VSIX 文件 `antigravity-markdown-viewer-1.0.0.vsix`：

1. **通过图形界面安装**：
   打开扩展面板 (`Ctrl+Shift+X`) -> 点击右上角 `...` 菜单 -> 选择 **`从 VSIX 安装... (Install from VSIX...)`** -> 选择 `/home/mazhao/workspace/AI_Learning/anti_markdown/antigravity-markdown-viewer-1.0.0.vsix`。
2. **或者通过命令行一键安装**：
   ```bash
   agy --install-extension /home/mazhao/workspace/AI_Learning/anti_markdown/antigravity-markdown-viewer-1.0.0.vsix
   ```

