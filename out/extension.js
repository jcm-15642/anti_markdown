'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const VIEW_TYPE = 'antiMarkdown.artifactEditor';
const NATIVE_VIEW_TYPE = 'antigravity.artifactEditor';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let lastActiveMarkdownUri = null;

/**
 * Generate a cryptographic nonce for Content Security Policy.
 * @returns {string}
 */
function createNonce() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Normalize any URI (including jetski-artifact: or vscode-remote:) to a clean file URI.
 * @param {vscode.Uri | undefined | null} candidate
 * @returns {vscode.Uri | null}
 */
function normalizeMarkdownUri(candidate) {
  if (!candidate || typeof candidate.path !== 'string') {
    return null;
  }
  if (candidate.scheme === 'jetski-artifact') {
    return vscode.Uri.file(candidate.path);
  }
  if (candidate.scheme === 'file' || candidate.scheme === 'vscode-remote' || candidate.scheme === 'untitled') {
    return candidate;
  }
  return vscode.Uri.file(candidate.path);
}

/**
 * Resolve the target Markdown URI from command arguments, active text editor, or active tab.
 * @param {vscode.Uri | undefined} inputUri
 * @returns {vscode.Uri | null}
 */
function resolveTargetUri(inputUri) {
  if (inputUri && inputUri instanceof vscode.Uri) {
    return normalizeMarkdownUri(inputUri);
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document) {
    const docUri = activeEditor.document.uri;
    if (
      activeEditor.document.languageId === 'markdown' ||
      docUri.path.endsWith('.md') ||
      docUri.path.endsWith('.markdown')
    ) {
      return normalizeMarkdownUri(docUri);
    }
  }

  try {
    const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
    if (activeTab && activeTab.input && typeof activeTab.input === 'object') {
      const tabUri = activeTab.input.uri || activeTab.input.modified;
      if (tabUri instanceof vscode.Uri) {
        return normalizeMarkdownUri(tabUri);
      }
    }
  } catch (_err) {
    // Ignore tab inspection errors on older host versions
  }

  if (lastActiveMarkdownUri) {
    return normalizeMarkdownUri(lastActiveMarkdownUri);
  }

  return null;
}

/**
 * Detect a valid cascadeId (conversation UUID) from the file path or ~/.gemini/antigravity/brain.
 * Providing cascadeId allows Antigravity IDE's native jetski-artifact viewer to initialize
 * full artifact features (Review bar, comments, and workspace context).
 * @param {string} filePath
 * @returns {string}
 */
function detectCascadeId(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const brainMatch = normalized.match(/\/\.gemini\/[^/]+\/brain\/([0-9a-fA-F-]{36})\//);
  if (brainMatch && UUID_REGEX.test(brainMatch[1])) {
    return brainMatch[1];
  }

  const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  try {
    if (fs.existsSync(brainDir)) {
      const entries = fs.readdirSync(brainDir, { withFileTypes: true });
      let latestId = '';
      let latestMtime = -1;
      for (const entry of entries) {
        if (entry.isDirectory() && UUID_REGEX.test(entry.name)) {
          const fullPath = path.join(brainDir, entry.name);
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestId = entry.name;
          }
        }
      }
      if (latestId) {
        return latestId;
      }
    }
  } catch (_err) {
    // Fallback to empty cascadeId if brain directory is unreadable
  }
  return '';
}

/**
 * Open a Markdown file in Antigravity IDE's native built-in `antigravity.artifactEditor`
 * by constructing a `jetski-artifact:` URI with stripped authority and detected `cascadeId`.
 * @param {vscode.Uri | undefined} inputUri
 * @param {vscode.ViewColumn} [viewColumn]
 */
async function openInNativeArtifactEditor(inputUri, viewColumn) {
  const targetUri = resolveTargetUri(inputUri);
  if (!targetUri) {
    vscode.window.showWarningMessage('请先打开或选择一个 Markdown (.md) 文件。');
    return;
  }

  lastActiveMarkdownUri = targetUri;
  const cascadeId = detectCascadeId(targetUri.fsPath || targetUri.path);
  const query = cascadeId ? `cascadeId=${encodeURIComponent(cascadeId)}` : '';

  // Key mechanism from agy/vscode/extension.js:
  // ArtifactEditorProvider expects scheme="jetski-artifact" and authority="" so that
  // a.uri.with({ query: "", scheme: "file" }) resolves to file:///path/to/file.md
  const artifactUri = vscode.Uri.from({
    scheme: 'jetski-artifact',
    authority: '',
    path: targetUri.path,
    query
  });

  try {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      artifactUri,
      NATIVE_VIEW_TYPE,
      {
        viewColumn: viewColumn || vscode.ViewColumn.Active,
        preview: false
      }
    );
  } catch (_err) {
    // Fallback if running in standard VS Code without the built-in google-antigravity extension
    await vscode.commands.executeCommand(
      'vscode.openWith',
      targetUri,
      VIEW_TYPE,
      {
        viewColumn: viewColumn || vscode.ViewColumn.Active,
        preview: false
      }
    );
  }
}

/**
 * Validate and resolve a file:// link or relative path safely.
 * @param {string} rawHref
 * @param {vscode.Uri} documentUri
 * @returns {{ fileUri: vscode.Uri, startLine: number, endLine: number } | null}
 */
function parseAndValidateFileTarget(rawHref, documentUri) {
  if (!rawHref || typeof rawHref !== 'string') {
    return null;
  }

  let cleaned = rawHref.trim();
  let hashPart = '';
  const hashIdx = cleaned.indexOf('#');
  if (hashIdx !== -1) {
    hashPart = cleaned.slice(hashIdx + 1);
    cleaned = cleaned.slice(0, hashIdx);
  }

  let startLine = 0;
  let endLine = 0;
  if (hashPart) {
    const lineMatch = hashPart.match(/^L(\d+)(?:-L?(\d+))?$/i);
    if (lineMatch) {
      startLine = Math.max(1, parseInt(lineMatch[1], 10));
      endLine = lineMatch[2] ? Math.max(startLine, parseInt(lineMatch[2], 10)) : startLine;
    }
  }

  let resolvedPath = '';
  if (cleaned.startsWith('file://')) {
    try {
      const parsed = vscode.Uri.parse(cleaned);
      resolvedPath = parsed.fsPath || parsed.path;
    } catch (_err) {
      return null;
    }
  } else if (cleaned.startsWith('/')) {
    resolvedPath = cleaned;
  } else if (cleaned.length > 0) {
    const baseDir = path.dirname(documentUri.fsPath || documentUri.path);
    resolvedPath = path.resolve(baseDir, cleaned);
  } else {
    resolvedPath = documentUri.fsPath || documentUri.path;
  }

  if (!resolvedPath || resolvedPath.includes('\0')) {
    return null;
  }

  const normalizedPath = path.normalize(resolvedPath);
  return {
    fileUri: vscode.Uri.file(normalizedPath),
    startLine,
    endLine
  };
}

/**
 * Open a resolved file target in VS Code text editor and highlight its line range if specified.
 * @param {string} rawHref
 * @param {vscode.Uri} documentUri
 */
async function openFileTargetInEditor(rawHref, documentUri) {
  const target = parseAndValidateFileTarget(rawHref, documentUri);
  if (!target) {
    return;
  }

  try {
    const stat = await vscode.workspace.fs.stat(target.fileUri);
    if (stat.type === vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealInExplorer', target.fileUri);
      return;
    }
  } catch (_err) {
    vscode.window.showWarningMessage(`无法找到目标文件: ${target.fileUri.fsPath}`);
    return;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(target.fileUri);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true
    });

    if (target.startLine > 0) {
      const zeroStart = Math.min(Math.max(0, target.startLine - 1), Math.max(0, doc.lineCount - 1));
      const zeroEnd = Math.min(Math.max(zeroStart, target.endLine - 1), Math.max(0, doc.lineCount - 1));
      const endLineText = doc.lineAt(zeroEnd).text;
      const range = new vscode.Range(zeroStart, 0, zeroEnd, endLineText.length);
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }
  } catch (err) {
    // If binary or custom file, fall back to vscode.open
    await vscode.commands.executeCommand('vscode.open', target.fileUri);
  }
}

/**
 * Build the HTML shell for the Webview using strict nonce-based CSP and zero inline scripts.
 * @param {vscode.Webview} webview
 * @param {vscode.ExtensionContext} context
 * @returns {string}
 */
function buildWebviewHtml(webview, context) {
  const nonce = createNonce();
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'viewer.css'));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'viewer.js'));

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource} data:`
  ].join('; ');

  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8">',
    `  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>Antigravity Artifact Viewer</title>',
    `  <link rel="stylesheet" href="${cssUri}">`,
    '</head>',
    '<body>',
    '  <div id="app-root" class="agy-root"></div>',
    `  <script nonce="${nonce}" src="${jsUri}"></script>`,
    '</body>',
    '</html>'
  ].join('\n');
}

/**
 * Compute localResourceRoots for a document so local relative images work safely.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri} documentUri
 * @returns {vscode.Uri[]}
 */
function getLocalResourceRoots(context, documentUri) {
  const roots = [
    vscode.Uri.joinPath(context.extensionUri, 'media'),
    vscode.Uri.joinPath(context.extensionUri, 'examples')
  ];

  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      roots.push(folder.uri);
    }
  }

  try {
    const docDir = vscode.Uri.file(path.dirname(documentUri.fsPath || documentUri.path));
    roots.push(docDir);
  } catch (_err) {
    // Ignore if untitled
  }

  const brainRoot = vscode.Uri.file(path.join(os.homedir(), '.gemini', 'antigravity', 'brain'));
  roots.push(brainRoot);

  return roots;
}

/**
 * Create a message payload describing the current document state for the webview.
 * @param {vscode.TextDocument} document
 * @param {vscode.Webview} webview
 * @param {boolean} isSidePreview
 */
function createDocumentPayload(document, webview, isSidePreview) {
  const config = vscode.workspace.getConfiguration('antiMarkdown');
  const filePath = document.uri.fsPath || document.uri.path;
  const fileName = path.basename(filePath);
  const docDirUri = vscode.Uri.file(path.dirname(filePath));
  const baseWebviewUri = webview.asWebviewUri(docDirUri).toString();
  const isBrainArtifact = /\/\.gemini\/[^/]+\/brain\//.test(filePath.replace(/\\/g, '/'));

  let lastModified = '';
  try {
    const stat = fs.statSync(filePath);
    lastModified = stat.mtime.toISOString();
  } catch (_err) {
    lastModified = new Date().toISOString();
  }

  return {
    type: 'documentUpdate',
    text: document.getText(),
    fileName,
    filePath,
    fileUri: document.uri.toString(),
    baseWebviewUri,
    isDirty: document.isDirty,
    isBrainArtifact,
    isSidePreview: Boolean(isSidePreview),
    lastModified,
    config: {
      defaultViewMode: config.get('defaultViewMode', 'preview'),
      showOutline: config.get('showOutline', true)
    }
  };
}

/**
 * Attach message handlers between a WebviewPanel and a TextDocument.
 * @param {vscode.WebviewPanel} webviewPanel
 * @param {vscode.TextDocument} document
 * @param {vscode.ExtensionContext} context
 * @param {boolean} isSidePreview
 */
function wireWebviewToDocument(webviewPanel, document, context, isSidePreview) {
  let isApplyingEditFromWebview = false;

  const sendUpdate = () => {
    if (!webviewPanel.visible) {
      return;
    }
    webviewPanel.webview.postMessage(
      createDocumentPayload(document, webviewPanel.webview, isSidePreview)
    );
  };

  const changeDocSub = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() === document.uri.toString()) {
      if (!isApplyingEditFromWebview) {
        sendUpdate();
      }
    }
  });

  const saveDocSub = vscode.workspace.onDidSaveTextDocument((savedDoc) => {
    if (savedDoc.uri.toString() === document.uri.toString()) {
      sendUpdate();
    }
  });

  const configSub = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('antiMarkdown')) {
      sendUpdate();
    }
  });

  const viewStateSub = webviewPanel.onDidChangeViewState((event) => {
    if (event.webviewPanel.active) {
      lastActiveMarkdownUri = document.uri;
    }
    if (event.webviewPanel.visible) {
      sendUpdate();
    }
  });

  const messageSub = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg.type !== 'string') {
      return;
    }

    switch (msg.type) {
      case 'ready': {
        sendUpdate();
        break;
      }

      case 'edit': {
        if (typeof msg.text !== 'string') {
          return;
        }
        if (msg.text === document.getText()) {
          return;
        }
        isApplyingEditFromWebview = true;
        try {
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
          );
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, fullRange, msg.text);
          await vscode.workspace.applyEdit(edit);
        } finally {
          isApplyingEditFromWebview = false;
        }
        break;
      }

      case 'toggleTaskItem': {
        const lineIndex = typeof msg.line === 'number' ? msg.line : -1;
        if (lineIndex >= 0 && lineIndex < document.lineCount) {
          const line = document.lineAt(lineIndex);
          const updated = line.text.replace(
            /^(\s*[-*+]\s+\[)([ xX])(\])/,
            (_m, prefix, state, suffix) => `${prefix}${state === ' ' ? 'x' : ' '}${suffix}`
          );
          if (updated !== line.text) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, line.range, updated);
            await vscode.workspace.applyEdit(edit);
          }
        }
        break;
      }

      case 'save': {
        await document.save();
        break;
      }

      case 'openFileLink': {
        if (typeof msg.href === 'string') {
          await openFileTargetInEditor(msg.href, document.uri);
        }
        break;
      }

      case 'openExternalLink': {
        if (typeof msg.href === 'string' && /^https?:\/\//i.test(msg.href)) {
          await vscode.env.openExternal(vscode.Uri.parse(msg.href));
        }
        break;
      }

      case 'openNative': {
        await openInNativeArtifactEditor(document.uri, webviewPanel.viewColumn);
        break;
      }

      case 'openNativeSide': {
        await openInNativeArtifactEditor(document.uri, vscode.ViewColumn.Beside);
        break;
      }

      case 'switchToTextEditor': {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          document.uri,
          'default',
          { viewColumn: webviewPanel.viewColumn, preview: false }
        );
        break;
      }

      case 'copyText': {
        if (typeof msg.text === 'string') {
          await vscode.env.clipboard.writeText(msg.text);
        }
        break;
      }

      case 'submitReviewComment': {
        const comment = typeof msg.comment === 'string' ? msg.comment.trim() : '';
        const selectedText = typeof msg.selectedText === 'string' ? msg.selectedText.trim() : '';
        const sectionHeading = typeof msg.heading === 'string' ? msg.heading.trim() : '';
        if (!comment) {
          return;
        }
        const filePath = document.uri.fsPath || document.uri.path;
        const formattedReview = [
          `[Artifact Review: ${path.basename(filePath)}${sectionHeading ? ' > ' + sectionHeading : ''}](file://${filePath})`,
          selectedText ? `> ${selectedText.split('\n').join('\n> ')}` : '',
          `Comment: ${comment}`
        ].filter(Boolean).join('\n');

        await vscode.env.clipboard.writeText(formattedReview);
        vscode.window.showInformationMessage(
          '已生成 Artifact 批注并复制到剪贴板（可直接粘贴至 Antigravity 对话框）。'
        );
        break;
      }

      default:
        break;
    }
  });

  webviewPanel.onDidDispose(() => {
    changeDocSub.dispose();
    saveDocSub.dispose();
    configSub.dispose();
    viewStateSub.dispose();
    messageSub.dispose();
  });
}

/**
 * CustomTextEditorProvider for `antiMarkdown.artifactEditor`.
 */
class AntigravityArtifactEditorProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
  }

  /**
   * @param {vscode.TextDocument} document
   * @param {vscode.WebviewPanel} webviewPanel
   * @param {vscode.CancellationToken} _token
   */
  async resolveCustomTextEditor(document, webviewPanel, _token) {
    lastActiveMarkdownUri = document.uri;

    const config = vscode.workspace.getConfiguration('antiMarkdown');
    const engineMode = config.get('engineMode', 'standalone');

    if (engineMode === 'native') {
      // Delegate directly to Antigravity IDE's native jetski-artifact viewer
      setTimeout(async () => {
        await openInNativeArtifactEditor(document.uri, webviewPanel.viewColumn);
      }, 40);
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: getLocalResourceRoots(this.context, document.uri)
    };

    webviewPanel.webview.html = buildWebviewHtml(webviewPanel.webview, this.context);
    wireWebviewToDocument(webviewPanel, document, this.context, false);
  }
}

/**
 * Open a live-synced Antigravity Artifact Preview panel to the side of the active editor.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Uri | undefined} inputUri
 */
async function openLivePreviewToSide(context, inputUri) {
  const targetUri = resolveTargetUri(inputUri);
  if (!targetUri) {
    vscode.window.showWarningMessage('请先打开或选择一个 Markdown (.md) 文件。');
    return;
  }

  lastActiveMarkdownUri = targetUri;
  const document = await vscode.workspace.openTextDocument(targetUri);
  const fileName = path.basename(targetUri.fsPath || targetUri.path);

  const panel = vscode.window.createWebviewPanel(
    'antiMarkdown.sidePreview',
    `Preview: ${fileName}`,
    {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true
    },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: getLocalResourceRoots(context, document.uri)
    }
  );

  panel.webview.html = buildWebviewHtml(panel.webview, context);
  wireWebviewToDocument(panel, document, context, true);
}

/**
 * Switch the active Markdown file between Text Editor, Antigravity Artifact Viewer Pro,
 * and Native Antigravity Artifact Viewer.
 * @param {vscode.Uri | undefined} inputUri
 */
async function switchEditorMode(inputUri) {
  const targetUri = resolveTargetUri(inputUri);
  if (!targetUri) {
    vscode.window.showWarningMessage('请先打开或选择一个 Markdown (.md) 文件。');
    return;
  }

  let currentEditorId = 'default';
  try {
    const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
    if (activeTab && activeTab.input && typeof activeTab.input.viewType === 'string') {
      currentEditorId = activeTab.input.viewType;
    }
  } catch (_err) {
    // Ignore
  }

  if (currentEditorId === VIEW_TYPE || currentEditorId === NATIVE_VIEW_TYPE) {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      targetUri,
      'default',
      { viewColumn: vscode.ViewColumn.Active, preview: false }
    );
  } else {
    const config = vscode.workspace.getConfiguration('antiMarkdown');
    const engineMode = config.get('engineMode', 'standalone');
    if (engineMode === 'native') {
      await openInNativeArtifactEditor(targetUri, vscode.ViewColumn.Active);
    } else {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        targetUri,
        VIEW_TYPE,
        { viewColumn: vscode.ViewColumn.Active, preview: false }
      );
    }
  }
}

/**
 * Interactive QuickPick command to configure how `.md` files open by default.
 */
async function configureDefaultAssociation() {
  const items = [
    {
      label: '$(book) Antigravity Artifact Viewer Pro (推荐)',
      description: '默认使用增强版内置编辑器打开所有 .md 文件（支持实时编辑、大纲、Mermaid、公式、代码行号跳转及一键切原生）',
      mode: 'pro'
    },
    {
      label: '$(sparkle) Antigravity 原生内置编辑器 (jetski-artifact)',
      description: '点击 .md 文件时自动调用 Antigravity IDE 原生 antigravity.artifactEditor 打开',
      mode: 'native'
    },
    {
      label: '$(code) VS Code 默认文本编辑器 (源码模式)',
      description: '点击 .md 文件时默认打开源码，按需通过右上角按钮打开 Antigravity 预览',
      mode: 'default'
    }
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: '选择打开项目中 Markdown (.md) 文件的默认方式'
  });

  if (!picked) {
    return;
  }

  const wbConfig = vscode.workspace.getConfiguration('workbench');
  const antiConfig = vscode.workspace.getConfiguration('antiMarkdown');
  const currentAssoc = Object.assign({}, wbConfig.get('editorAssociations') || {});

  if (picked.mode === 'pro') {
    currentAssoc['*.md'] = VIEW_TYPE;
    currentAssoc['*.markdown'] = VIEW_TYPE;
    await wbConfig.update('editorAssociations', currentAssoc, vscode.ConfigurationTarget.Global);
    await antiConfig.update('engineMode', 'standalone', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('已将默认 Markdown 编辑器设为 Antigravity Artifact Viewer Pro。');
  } else if (picked.mode === 'native') {
    currentAssoc['*.md'] = VIEW_TYPE;
    currentAssoc['*.markdown'] = VIEW_TYPE;
    await wbConfig.update('editorAssociations', currentAssoc, vscode.ConfigurationTarget.Global);
    await antiConfig.update('engineMode', 'native', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('已配置为自动转发至 Antigravity IDE 原生内置编辑器 (antigravity.artifactEditor)。');
  } else {
    currentAssoc['*.md'] = 'default';
    currentAssoc['*.markdown'] = 'default';
    await wbConfig.update('editorAssociations', currentAssoc, vscode.ConfigurationTarget.Global);
    await antiConfig.update('engineMode', 'standalone', vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('已恢复为默认源码编辑器（可随时通过右上角按钮打开 Antigravity 预览）。');
  }
}

/**
 * Extension entry point.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const provider = new AntigravityArtifactEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: true
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document) {
        const uri = editor.document.uri;
        if (
          editor.document.languageId === 'markdown' ||
          uri.path.endsWith('.md') ||
          uri.path.endsWith('.markdown')
        ) {
          lastActiveMarkdownUri = uri;
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('antiMarkdown.openNativeArtifact', async (uri) => {
      await openInNativeArtifactEditor(uri, vscode.ViewColumn.Active);
    }),

    vscode.commands.registerCommand('antiMarkdown.openNativeArtifactToSide', async (uri) => {
      await openInNativeArtifactEditor(uri, vscode.ViewColumn.Beside);
    }),

    vscode.commands.registerCommand('antiMarkdown.openStandaloneViewer', async (uri) => {
      const targetUri = resolveTargetUri(uri);
      if (!targetUri) {
        vscode.window.showWarningMessage('请先打开或选择一个 Markdown (.md) 文件。');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        targetUri,
        VIEW_TYPE,
        { viewColumn: vscode.ViewColumn.Active, preview: false }
      );
    }),

    vscode.commands.registerCommand('antiMarkdown.openPreviewToSide', async (uri) => {
      await openLivePreviewToSide(context, uri);
    }),

    vscode.commands.registerCommand('antiMarkdown.switchEditor', async (uri) => {
      await switchEditorMode(uri);
    }),

    vscode.commands.registerCommand('antiMarkdown.toggleDefaultAssociation', async () => {
      await configureDefaultAssociation();
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  normalizeMarkdownUri,
  detectCascadeId,
  parseAndValidateFileTarget
};

