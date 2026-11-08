'use strict';

let vscode;
try {
  vscode = require('vscode');
} catch (_err) {
  vscode = null;
}
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');

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
  const mermaidJsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'agy-mermaid.js'));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'viewer.js'));

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
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
    `  <script nonce="${nonce}" src="${mermaidJsUri}"></script>`,
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

// In-memory document baselines for diff review and accept/reject tracking
const documentBaselines = new Map();

/**
 * Get git HEAD content for a file if it is in a git repository.
 * @param {string} filePath
 * @returns {string | null}
 */
function getGitHeadContent(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      return null;
    }
    const gitRoot = cp
      .execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 1200,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      .trim();
    if (!gitRoot) {
      return null;
    }
    const relPath = path.relative(gitRoot, filePath).replace(/\\/g, '/');
    const headContent = cp.execFileSync('git', ['show', `HEAD:${relPath}`], {
      cwd: gitRoot,
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 15 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return headContent;
  } catch (_err) {
    return null;
  }
}

/**
 * Get the original baseline content for a document (before AI edits or uncommitted edits).
 * @param {vscode.TextDocument} document
 * @returns {string}
 */
function getDocumentBaseline(document) {
  const uriStr = document.uri.toString();
  if (documentBaselines.has(uriStr)) {
    return documentBaselines.get(uriStr);
  }

  const filePath = document.uri.fsPath || document.uri.path;
  const gitHead = getGitHeadContent(filePath);
  if (typeof gitHead === 'string') {
    documentBaselines.set(uriStr, gitHead);
    return gitHead;
  }

  if (filePath && fs.existsSync(filePath) && document.isDirty) {
    try {
      const diskContent = fs.readFileSync(filePath, 'utf8');
      documentBaselines.set(uriStr, diskContent);
      return diskContent;
    } catch (_e) {}
  }

  const text = document.getText();
  documentBaselines.set(uriStr, text);
  return text;
}

/**
 * Compute line-level diff and hunks between originalText and modifiedText.
 * Uses prefix/suffix trimming + LCS for high performance and accurate hunk grouping.
 * @param {string} originalText
 * @param {string} modifiedText
 * @returns {{ hasDiff: boolean, addedCount: number, removedCount: number, addedLines: number[], hunks: Array<any> }}
 */
function computeFastLineDiff(originalText, modifiedText) {
  if (originalText === modifiedText) {
    return {
      hasDiff: false,
      addedCount: 0,
      removedCount: 0,
      addedLines: [],
      hunks: []
    };
  }

  const origLines = (originalText || '').replace(/\r\n/g, '\n').split('\n');
  const modLines = (modifiedText || '').replace(/\r\n/g, '\n').split('\n');

  let startPrefix = 0;
  while (
    startPrefix < origLines.length &&
    startPrefix < modLines.length &&
    origLines[startPrefix] === modLines[startPrefix]
  ) {
    startPrefix++;
  }

  let endOrig = origLines.length - 1;
  let endMod = modLines.length - 1;
  while (
    endOrig >= startPrefix &&
    endMod >= startPrefix &&
    origLines[endOrig] === modLines[endMod]
  ) {
    endOrig--;
    endMod--;
  }

  const trimmedOrig = origLines.slice(startPrefix, endOrig + 1);
  const trimmedMod = modLines.slice(startPrefix, endMod + 1);
  const m = trimmedOrig.length;
  const n = trimmedMod.length;

  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (trimmedOrig[i] === trimmedMod[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const diffItems = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && trimmedOrig[i - 1] === trimmedMod[j - 1]) {
      diffItems.unshift({
        type: 'same',
        modLine: startPrefix + j - 1,
        origLine: startPrefix + i - 1,
        text: trimmedMod[j - 1]
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffItems.unshift({
        type: 'add',
        modLine: startPrefix + j - 1,
        origLine: startPrefix + i - 1,
        text: trimmedMod[j - 1]
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffItems.unshift({
        type: 'del',
        origLine: startPrefix + i - 1,
        modLine: startPrefix + j - 1,
        text: trimmedOrig[i - 1]
      });
      i--;
    }
  }

  let addedCount = 0;
  let removedCount = 0;
  const addedLines = [];
  const hunks = [];
  let currentHunk = null;

  for (let idx = 0; idx < diffItems.length; idx++) {
    const item = diffItems[idx];
    if (item.type === 'add' || item.type === 'del') {
      if (!currentHunk) {
        currentHunk = {
          hunkIndex: hunks.length,
          startModLine: item.type === 'add' ? item.modLine : item.modLine + 1,
          endModLine: item.type === 'add' ? item.modLine : item.modLine,
          startOrigLine: item.type === 'del' ? item.origLine : item.origLine + 1,
          endOrigLine: item.type === 'del' ? item.origLine : item.origLine,
          addedCount: 0,
          removedCount: 0,
          addedTexts: [],
          deletedTexts: []
        };
      }
      if (item.type === 'add') {
        currentHunk.addedCount++;
        currentHunk.addedTexts.push(item.text);
        currentHunk.endModLine = Math.max(currentHunk.endModLine, item.modLine);
        addedLines.push(item.modLine);
        addedCount++;
      } else {
        currentHunk.removedCount++;
        currentHunk.deletedTexts.push(item.text);
        currentHunk.endOrigLine = Math.max(currentHunk.endOrigLine, item.origLine);
        removedCount++;
      }
    } else {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
    }
  }
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return {
    hasDiff: addedCount > 0 || removedCount > 0,
    addedCount,
    removedCount,
    addedLines,
    hunks
  };
}

/**
 * Compute document diff against git HEAD or baseline content.
 * @param {vscode.TextDocument} document
 * @returns {{ hasDiff: boolean, addedCount: number, removedCount: number, addedLines: number[], hunks: Array<any> }}
 */
function computeDocumentDiff(document) {
  try {
    const config = vscode.workspace.getConfiguration('antiMarkdown');
    if (config.get('showDiffReview', true) === false) {
      return { hasDiff: false, addedCount: 0, removedCount: 0, addedLines: [], hunks: [] };
    }
    const filePath = document.uri.fsPath || document.uri.path;
    const uriStr = document.uri.toString();
    const currentText = document.getText();

    // Check if git HEAD matches currentText
    const gitHead = getGitHeadContent(filePath);
    if (typeof gitHead === 'string') {
      if (gitHead === currentText) {
        documentBaselines.set(uriStr, gitHead);
        return { hasDiff: false, addedCount: 0, removedCount: 0, addedLines: [], hunks: [] };
      }
      if (!documentBaselines.has(uriStr)) {
        documentBaselines.set(uriStr, gitHead);
      }
    }

    const baseline = getDocumentBaseline(document);
    return computeFastLineDiff(baseline, currentText);
  } catch (_e) {
    return { hasDiff: false, addedCount: 0, removedCount: 0, addedLines: [], hunks: [] };
  }
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

  const rawPlatforms = config.get('enabledAiPlatforms', ['vscode', 'antigravity', 'claude', 'codex']);
  const enabledAiPlatforms =
    Array.isArray(rawPlatforms) && rawPlatforms.length > 0
      ? rawPlatforms
      : ['vscode', 'antigravity', 'claude', 'codex'];

  const diff = computeDocumentDiff(document);

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
    diff,
    config: {
      showOutline: config.get('showOutline', true),
      enabledAiPlatforms
    }
  };
}

const Module = require('module');

const AI_PLATFORM_IDS = ['vscode', 'antigravity', 'claude', 'codex'];
const AI_PLATFORM_META = {
  vscode: { icon: '💬', label: 'VS Code' },
  antigravity: { icon: '✦', label: 'Antigravity' },
  claude: { icon: '✴', label: 'Claude Code' },
  codex: { icon: '◎', label: 'Codex' }
};

/**
 * Read enabled AI platforms from configuration.
 * @returns {string[]}
 */
function getEnabledAiPlatforms() {
  const raw = vscode.workspace.getConfiguration('antiMarkdown').get('enabledAiPlatforms', AI_PLATFORM_IDS);
  if (!Array.isArray(raw)) {
    return AI_PLATFORM_IDS.slice();
  }
  return AI_PLATFORM_IDS.filter((id) => raw.includes(id));
}

/**
 * Compute a valid 0-based vscode.Selection for 1-based [startLineNumber, endLineNumber].
 * @param {vscode.TextDocument} document
 * @param {number} startLineNumber
 * @param {number} endLineNumber
 * @param {string} [selectedText]
 * @returns {vscode.Selection}
 */
function buildDocumentSelection(document, startLineNumber, endLineNumber, selectedText) {
  const maxLine = Math.max(0, document.lineCount - 1);
  const zeroStart = Math.min(maxLine, Math.max(0, (Number(startLineNumber) || 1) - 1));
  const zeroEnd = Math.min(maxLine, Math.max(zeroStart, (Number(endLineNumber) || startLineNumber || 1) - 1));
  let startChar = 0;
  let endChar = document.lineAt(zeroEnd).text.length;

  if (selectedText && typeof selectedText === 'string') {
    const clean = selectedText.trim();
    if (clean) {
      const fullText = document.getText();
      const idx = fullText.indexOf(clean);
      if (idx !== -1) {
        const startPos = document.positionAt(idx);
        const endPos = document.positionAt(idx + clean.length);
        return new vscode.Selection(startPos, endPos);
      }
      const lineText = document.lineAt(zeroStart).text;
      const firstLineClean = clean.split('\n')[0];
      const colIdx = lineText.indexOf(firstLineClean);
      if (colIdx !== -1) {
        startChar = colIdx;
        if (zeroStart === zeroEnd) {
          endChar = Math.min(lineText.length, colIdx + firstLineClean.length);
        }
      }
    }
  }

  return new vscode.Selection(zeroStart, startChar, zeroEnd, endChar);
}

/**
 * Temporarily expose a synthetic `activeTextEditor` on a target extension's `vscode.window`
 * during `fn()` so commands like `claude-vscode.insertAtMention` and `chatgpt.addToThread`
 * read `{ document, selection }` directly without ever calling `showTextDocument`.
 * @param {string} extensionId
 * @param {object} syntheticEditor
 * @param {() => Promise<any>} fn
 */
async function withSyntheticActiveEditor(extensionId, syntheticEditor, fn) {
  const patchedWindows = [];
  const patchWindow = (winObj) => {
    if (!winObj || patchedWindows.some((entry) => entry.winObj === winObj)) {
      return;
    }
    try {
      const origDesc = Object.getOwnPropertyDescriptor(winObj, 'activeTextEditor');
      Object.defineProperty(winObj, 'activeTextEditor', {
        get: () => syntheticEditor,
        configurable: true,
        enumerable: true
      });
      patchedWindows.push({ winObj, origDesc });
    } catch (_err) {
      // Ignore if non-configurable
    }
  };

  try {
    patchWindow(vscode.window);
    const ext = vscode.extensions.getExtension(extensionId);
    if (ext) {
      if (!ext.isActive) {
        try {
          await ext.activate();
        } catch (_err) {
          // Ignore activation error
        }
      }
      if (ext.extensionPath) {
        try {
          const extRequire = Module.createRequire(path.join(ext.extensionPath, 'package.json'));
          const extVscode = extRequire('vscode');
          if (extVscode && extVscode.window) {
            patchWindow(extVscode.window);
          }
        } catch (_err) {
          // Ignore require error
        }
      }
    }
    return await fn();
  } finally {
    for (const { winObj, origDesc } of patchedWindows) {
      try {
        if (origDesc) {
          Object.defineProperty(winObj, 'activeTextEditor', origDesc);
        }
      } catch (_err) {
        // Ignore restore error
      }
    }
  }
}

/**
 * Send the selected file + line range to a single specific AI platform
 * (`vscode`, `antigravity`, `claude`, or `codex`) without ever opening a raw text editor.
 * @param {vscode.TextDocument} document
 * @param {vscode.WebviewPanel | null} webviewPanel
 * @param {object} msg
 */
async function sendSelectionToSinglePlatform(document, webviewPanel, msg) {
  const startLineNumber = Math.max(1, Number(msg.startLineNumber) || 1);
  const endLineNumber = Math.max(startLineNumber, Number(msg.endLineNumber) || startLineNumber);
  const selection = buildDocumentSelection(document, startLineNumber, endLineNumber, msg.selectedText);
  const cleanUri = normalizeMarkdownUri(document.uri) || document.uri;
  const fileUriStr = cleanUri.toString();
  const availableCommands = await vscode.commands.getCommands(true);

  let platform = typeof msg.platform === 'string' ? msg.platform.toLowerCase() : '';
  if (!platform) {
    if (availableCommands.includes('antigravity.addContext')) {
      platform = 'antigravity';
    } else if (availableCommands.includes('claude-vscode.insertAtMention')) {
      platform = 'claude';
    } else if (availableCommands.includes('chatgpt.addToThread')) {
      platform = 'codex';
    } else {
      platform = 'vscode';
    }
  }

  // 1. Antigravity IDE: direct RPC command
  if (platform === 'antigravity') {
    if (availableCommands.includes('antigravity.addContext')) {
      try {
        await vscode.commands.executeCommand('antigravity.addContext', {
          type: 'file',
          uri: fileUriStr,
          range: {
            startLineNumber,
            endLineNumber
          }
        });
        return;
      } catch (_err) {
        // Ignore
      }
    }
    vscode.window.showWarningMessage('当前环境未检测到 Antigravity IDE 内置聊天接口 (antigravity.addContext)。');
    return;
  }

  // 2. VS Code Built-in Chat / Copilot: pass file + range directly to attachSelection
  if (platform === 'vscode') {
    if (availableCommands.includes('workbench.action.chat.attachSelection')) {
      const endLineIdx = Math.min(Math.max(0, document.lineCount - 1), endLineNumber - 1);
      const endCol = Math.max(1, document.lineAt(endLineIdx).text.length + 1);
      await vscode.commands.executeCommand(
        'workbench.action.chat.attachSelection',
        null,
        [
          {
            _parent: { resource: cleanUri },
            _range: {
              startLineNumber,
              startColumn: 1,
              endLineNumber,
              endColumn: endCol
            }
          }
        ]
      );
      if (availableCommands.includes('workbench.action.chat.open')) {
        await vscode.commands.executeCommand('workbench.action.chat.open');
      }
    } else {
      vscode.window.showWarningMessage('当前环境未检测到 VS Code Chat (workbench.action.chat.attachSelection)。');
    }
    return;
  }

  // Build synthetic TextEditor with normalized file URI so Claude Code & Codex read it directly
  // without ever calling vscode.window.showTextDocument
  const syntheticDocument = new Proxy(document, {
    get(target, prop, receiver) {
      if (prop === 'uri') {
        return cleanUri;
      }
      if (prop === 'fileName') {
        return cleanUri.fsPath || target.fileName;
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });

  const syntheticEditor = {
    document: syntheticDocument,
    selection,
    selections: [selection],
    visibleRanges: [new vscode.Range(selection.start, selection.end)],
    options: { tabSize: 2, insertSpaces: true },
    viewColumn: (webviewPanel && webviewPanel.viewColumn) || vscode.ViewColumn.One
  };

  // 3. Claude Code: execute native claude-vscode.insertAtMention with syntheticEditor
  if (platform === 'claude') {
    if (availableCommands.includes('claude-vscode.insertAtMention')) {
      await withSyntheticActiveEditor('anthropic.claude-code', syntheticEditor, async () => {
        await vscode.commands.executeCommand('claude-vscode.insertAtMention');
      });
    } else if (availableCommands.includes('claude-code.insertAtMentioned')) {
      await withSyntheticActiveEditor('anthropic.claude-code', syntheticEditor, async () => {
        await vscode.commands.executeCommand('claude-code.insertAtMentioned');
      });
    } else {
      vscode.window.showWarningMessage('当前环境未检测到 Claude Code 插件 (claude-vscode.insertAtMention)。');
    }
    return;
  }

  // 4. OpenAI Codex: execute native chatgpt.addToThread with syntheticEditor
  if (platform === 'codex') {
    if (availableCommands.includes('chatgpt.addToThread')) {
      await withSyntheticActiveEditor('openai.chatgpt', syntheticEditor, async () => {
        await vscode.commands.executeCommand('chatgpt.addToThread');
      });
    } else {
      vscode.window.showWarningMessage('当前环境未检测到 OpenAI Codex 插件 (chatgpt.addToThread)。');
    }
  }
}

/**
 * Build a crisp inline SVG data URI for the `L<start>-<end>` range badge
 * matching `.agy-selection-range-badge` in the Markdown viewer.
 * @param {number} start1
 * @param {number} end1
 * @returns {{ uri: string, width: number }}
 */
function buildRangeBadgeSvgDataUri(start1, end1) {
  const label = `L${start1}-${end1}`;
  const width = Math.max(48, Math.round(label.length * 7.5 + 14));
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">`,
    `  <rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="4.5" fill="#18181b" stroke="#3f3f46"/>`,
    `  <text x="${(width / 2).toFixed(1)}" y="16" text-anchor="middle" fill="#d4d4d8" font-family="ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace" font-size="11.5" font-weight="600">${label}</text>`,
    '</svg>'
  ].join('');
  return {
    uri: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    width
  };
}

/**
 * Build a crisp inline SVG data URI for each AI platform pill button
 * (`💬 VS Code`, `✦ Antigravity`, `✴ Claude Code`, `◎ Codex`)
 * matching `.agy-selection-pill-btn` in the Markdown viewer.
 * @param {string} platformId
 * @returns {string}
 */
function buildPlatformPillSvgDataUri(platformId) {
  let width = 88;
  let iconSvg = '';
  let label = '';
  let textX = 25;

  if (platformId === 'vscode') {
    width = 80;
    label = 'VS Code';
    textX = 25;
    iconSvg =
      '<path d="M10.5 8.2h8a1.8 1.8 0 0 1 1.8 1.8v4.2a1.8 1.8 0 0 1-1.8 1.8h-4.4l-2.6 2.1v-2.1h-1a1.8 1.8 0 0 1-1.8-1.8V10a1.8 1.8 0 0 1 1.8-1.8z" fill="none" stroke="#60a5fa" stroke-width="1.35" stroke-linejoin="round"/>';
  } else if (platformId === 'antigravity') {
    width = 96;
    label = 'Antigravity';
    textX = 24;
    iconSvg = '<path d="M14.5 6.4 L16.1 10.4 L20.1 12 L16.1 13.6 L14.5 17.6 L12.9 13.6 L8.9 12 L12.9 10.4 Z" fill="#60a5fa"/>';
  } else if (platformId === 'claude') {
    width = 104;
    label = 'Claude Code';
    textX = 24;
    iconSvg = [
      '<g stroke="#60a5fa" stroke-width="1.4" stroke-linecap="round">',
      '  <line x1="14.5" y1="6.8" x2="14.5" y2="17.2"/>',
      '  <line x1="9.3" y1="12" x2="19.7" y2="12"/>',
      '  <line x1="10.8" y1="8.3" x2="18.2" y2="15.7"/>',
      '  <line x1="18.2" y1="8.3" x2="10.8" y2="15.7"/>',
      '</g>'
    ].join('');
  } else {
    width = 72;
    label = 'Codex';
    textX = 25;
    iconSvg = [
      '<circle cx="14.5" cy="12" r="5" fill="none" stroke="#60a5fa" stroke-width="1.3"/>',
      '<circle cx="14.5" cy="12" r="2.3" fill="none" stroke="#60a5fa" stroke-width="1.2"/>'
    ].join('');
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">`,
    `  <rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="5" fill="#3b82f6" fill-opacity="0.16" stroke="#60a5fa" stroke-opacity="0.42"/>`,
    `  ${iconSvg}`,
    `  <text x="${textX}" y="15.8" fill="#60a5fa" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" font-size="11.5" font-weight="600">${label}</text>`,
    '</svg>'
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

const PLATFORM_PILL_DATA_URIS = {
  vscode: buildPlatformPillSvgDataUri('vscode'),
  antigravity: buildPlatformPillSvgDataUri('antigravity'),
  claude: buildPlatformPillSvgDataUri('claude'),
  codex: buildPlatformPillSvgDataUri('codex')
};

const PLATFORM_PILL_WIDTHS = {
  vscode: 80,
  antigravity: 96,
  claude: 104,
  codex: 72
};

/**
 * Universal Floating AI Capsule for ALL files opened in standard text editors:
 * Pops up a floating Hover capsule with the exact pill styling of the Markdown viewer
 * (`[ Lx-y ]  [ 💬 VS Code ]  [ ✦ Antigravity ]  [ ✴ Claude Code ]  [ ◎ Codex ]`)
 * positioned outside the selected text so it never occludes selected text.
 * @param {vscode.ExtensionContext} context
 */
function registerUniversalSelectionCapsule(context) {
  let hoverTimer = null;

  const updateContextKeys = () => {
    const enabled = getEnabledAiPlatforms();
    AI_PLATFORM_IDS.forEach((id) => {
      vscode.commands.executeCommand('setContext', `antiMarkdown.ai.${id}`, enabled.includes(id));
    });
  };

  // Ensure default hover placement is BELOW the anchor line so multi-line selections
  // and lines above the selection are never covered by the floating AI capsule.
  try {
    const hoverCfg = vscode.workspace.getConfiguration('editor.hover');
    const inspected = hoverCfg.inspect('above');
    if (!inspected || (inspected.globalValue === undefined && inspected.workspaceValue === undefined)) {
      hoverCfg.update('above', false, vscode.ConfigurationTarget.Global).then(undefined, () => {});
    }
  } catch (_e) {}

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ scheme: '*' }, { pattern: '**/*' }, { pattern: '**' }],
      {
        provideHover(document, position) {
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document !== document || editor.selection.isEmpty) {
            return null;
          }
          const sel = editor.selection;
          const startLine0 = sel.start.line;
          const endLine0 = sel.end.character === 0 && sel.end.line > startLine0 ? sel.end.line - 1 : sel.end.line;

          // Accept hover on any line of the active selection (including the trailing boundary)
          const maxLine0 = Math.max(endLine0, sel.end.line);
          if (position.line < startLine0 || position.line > maxLine0) {
            return null;
          }

          if (vscode.workspace.getConfiguration('antiMarkdown').get('selectionHoverCapsule', true) === false) {
            return null;
          }
          const enabled = getEnabledAiPlatforms();
          if (enabled.length === 0) {
            return null;
          }

          const start1 = startLine0 + 1;
          const end1 = endLine0 + 1;
          const rangeBadge = buildRangeBadgeSvgDataUri(start1, end1);
          const pills = enabled.map((id) => {
            const meta = AI_PLATFORM_META[id];
            const pillUri = PLATFORM_PILL_DATA_URIS[id];
            return `[![${meta.label}](${pillUri})](command:antiMarkdown.sendSelectionTo.${id} "仅发送到 ${meta.label} 聊天框")`;
          });

          // Pure CommonMark markdown: renders clean, clickable image buttons in a single horizontal row
          // without any HTML <div> wrappers that break markdown link parsing and cause text leakage.
          const md = new vscode.MarkdownString(
            `![L${start1}-${end1}](${rangeBadge.uri}) &nbsp; ${pills.join(' &nbsp; ')}`
          );
          md.isTrusted = true;

          let anchorLine = endLine0;
          let anchorCol = sel.end.character;
          if (sel.end.character === 0 && sel.end.line > startLine0) {
            anchorCol = document.lineAt(endLine0).text.length;
          }

          const anchorPos = new vscode.Position(anchorLine, anchorCol);
          return new vscode.Hover(md, new vscode.Range(anchorPos, anchorPos));
        }
      }
    ),
    vscode.window.onDidChangeTextEditorSelection((ev) => {
      if (ev.textEditor !== vscode.window.activeTextEditor) {
        return;
      }
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (ev.textEditor.selection.isEmpty) {
        vscode.commands.executeCommand('editor.action.hideHover').then(undefined, () => {});
        return;
      }
      // 220ms debounce: allows smooth slow-dragging without premature triggering or selection reset ("断触").
      // Never mutates editor.selection, preserving 100% native Monaco drag mechanics.
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        const active = vscode.window.activeTextEditor;
        if (!active || active.selection.isEmpty) {
          return;
        }

        vscode.commands
          .executeCommand('editor.action.showHover', { focus: 'noAutoFocus' })
          .then(undefined, () => {});
      }, 220);
    }),
    vscode.workspace.onDidChangeConfiguration((ev) => {
      if (ev.affectsConfiguration('antiMarkdown')) {
        updateContextKeys();
      }
    })
  );

  AI_PLATFORM_IDS.forEach((id) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(`antiMarkdown.sendSelectionTo.${id}`, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
          vscode.window.showInformationMessage('请先在编辑器中选中文本。');
          return;
        }
        const s = editor.selection.start.line + 1;
        let e = editor.selection.end.line + 1;
        if (editor.selection.end.character === 0 && e > s) {
          e -= 1;
        }
        const selectedText = editor.document.getText(editor.selection);
        vscode.commands.executeCommand('editor.action.hideHover').then(undefined, () => {});
        await sendSelectionToSinglePlatform(editor.document, null, {
          platform: id,
          startLineNumber: s,
          endLineNumber: e,
          selectedText
        });
      })
    );
  });

  updateContextKeys();
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
        isApplyingEditFromWebview = true;
        try {
          if (msg.text !== document.getText()) {
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fullRange, msg.text);
            await vscode.workspace.applyEdit(edit);
          }
          if (msg.autoSave && document.isDirty) {
            await document.save();
          }
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
            await document.save();
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

      case 'updateAiPlatforms': {
        if (Array.isArray(msg.platforms)) {
          const allowed = ['vscode', 'antigravity', 'claude', 'codex'];
          const cleaned = msg.platforms.filter((p) => allowed.includes(p));
          const antiConfig = vscode.workspace.getConfiguration('antiMarkdown');
          try {
            await antiConfig.update('enabledAiPlatforms', cleaned, vscode.ConfigurationTarget.Global);
          } catch (_err) {
            // Ignore config update error
          }
        }
        break;
      }

      case 'sendSelectionToPlatform':
      case 'addSelectionToChat': {
        await sendSelectionToSinglePlatform(document, webviewPanel, msg);
        break;
      }

      case 'acceptAllDiff': {
        try {
          await vscode.commands.executeCommand('antigravity.prioritized.agentAcceptAllInFile');
        } catch (_e) {}
        try {
          await vscode.commands.executeCommand('antigravity.prioritized.agentAcceptFocusedHunk');
        } catch (_e) {}
        documentBaselines.set(document.uri.toString(), document.getText());
        if (document.isDirty) {
          await document.save();
        }
        sendUpdate();
        vscode.window.setStatusBarMessage('Anti Markdown: 已接受全部修改', 3000);
        break;
      }

      case 'rejectAllDiff': {
        try {
          await vscode.commands.executeCommand('antigravity.prioritized.agentRejectAllInFile');
        } catch (_e) {}
        try {
          await vscode.commands.executeCommand('antigravity.prioritized.agentRejectFocusedHunk');
        } catch (_e) {}
        const baseline = getDocumentBaseline(document);
        if (typeof baseline === 'string' && baseline !== document.getText()) {
          isApplyingEditFromWebview = true;
          try {
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fullRange, baseline);
            await vscode.workspace.applyEdit(edit);
            await document.save();
          } finally {
            isApplyingEditFromWebview = false;
          }
        }
        documentBaselines.set(document.uri.toString(), document.getText());
        sendUpdate();
        vscode.window.setStatusBarMessage('Anti Markdown: 已还原全部修改', 3000);
        break;
      }

      case 'acceptDiffHunk': {
        try {
          await vscode.commands.executeCommand('antigravity.prioritized.agentAcceptFocusedHunk');
        } catch (_e) {}
        if (msg.hunk && typeof msg.hunk.startOrigLine === 'number') {
          const uriStr = document.uri.toString();
          const baseline = getDocumentBaseline(document);
          const bLines = baseline.replace(/\r\n/g, '\n').split('\n');
          const origCount = Math.max(0, msg.hunk.endOrigLine - msg.hunk.startOrigLine + 1);
          bLines.splice(msg.hunk.startOrigLine, origCount, ...(msg.hunk.addedTexts || []));
          documentBaselines.set(uriStr, bLines.join('\n'));
        }
        if (document.isDirty) {
          await document.save();
        }
        sendUpdate();
        vscode.window.setStatusBarMessage('Anti Markdown: 已接受此段修改', 2500);
        break;
      }

      case 'rejectDiffHunk': {
        try {
          await vscode.commands.executeCommand('antigravity.prioritized.agentRejectFocusedHunk');
        } catch (_e) {}
        if (msg.hunk && typeof msg.hunk.startModLine === 'number') {
          isApplyingEditFromWebview = true;
          try {
            const lines = document.getText().replace(/\r\n/g, '\n').split('\n');
            const count = Math.max(0, msg.hunk.endModLine - msg.hunk.startModLine + 1);
            lines.splice(msg.hunk.startModLine, count, ...(msg.hunk.deletedTexts || []));
            const newText = lines.join('\n');
            const fullRange = new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length)
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, fullRange, newText);
            await vscode.workspace.applyEdit(edit);
            await document.save();
          } finally {
            isApplyingEditFromWebview = false;
          }
        }
        sendUpdate();
        vscode.window.setStatusBarMessage('Anti Markdown: 已还原此段修改', 2500);
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

  // Floating AI capsule for selections in ALL files (CodeLens + status bar + context menu)
  registerUniversalSelectionCapsule(context);

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
  parseAndValidateFileTarget,
  computeFastLineDiff,
  computeDocumentDiff,
  getGitHeadContent
};

