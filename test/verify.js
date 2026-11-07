'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

/**
 * Compute CRC32 for PNG chunks and ZIP entries.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Generate a 128x128 RGBA PNG icon at media/icon.png using Node's built-in zlib.
 */
function generateExtensionIconPng(targetPath) {
  const width = 128;
  const height = 128;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = Math.max(0, Math.abs(x - 63.5) - 38.5);
      const dy = Math.max(0, Math.abs(y - 63.5) - 38.5);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 20) {
        rawData[px] = 0;
        rawData[px + 1] = 0;
        rawData[px + 2] = 0;
        rawData[px + 3] = 0;
        continue;
      }

      let r = Math.round(15 + (x / width) * 25);
      let g = Math.round(23 + (y / height) * 30);
      let b = Math.round(42 + ((x + y) / (width + height)) * 95);

      if (dist > 16.5) {
        r = 96;
        g = 165;
        b = 250;
      }

      const inLeftBar = x >= 26 && x <= 37 && y >= 42 && y <= 86;
      const inRightBar = x >= 70 && x <= 81 && y >= 42 && y <= 86;
      const inLeftDiag = y >= 42 && y <= 74 && Math.abs((x - 32) - (y - 42) * 0.65) < 5.5;
      const inRightDiag = y >= 42 && y <= 74 && Math.abs((75 - x) - (y - 42) * 0.65) < 5.5;

      const sx = x - 96;
      const sy = y - 44;
      const inSparkle = (Math.abs(sx) * 2.2 + Math.abs(sy) < 16) || (Math.abs(sy) * 2.2 + Math.abs(sx) < 16);

      if (inLeftBar || inRightBar || inLeftDiag || inRightDiag) {
        r = 248;
        g = 250;
        b = 252;
      } else if (inSparkle) {
        r = 192;
        g = 132;
        b = 252;
      }

      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
      rawData[px + 3] = 255;
    }
  }

  function makeChunk(type, data) {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crcVal = crc32(buf.subarray(4, 8 + data.length));
    buf.writeUInt32BE(crcVal, 8 + data.length);
    return buf;
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const pngBuffer = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(targetPath, pngBuffer);
}

/**
 * Create a standard ZIP archive buffer from an array of { name: string, data: Buffer } entries.
 */
function buildZipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const uncompressed = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(uncompressed, { level: 9 });
    const entryCrc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5621, 12);
    localHeader.writeUInt32LE(entryCrc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5621, 14);
    centralHeader.writeUInt32LE(entryCrc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

/**
 * Package the VS Code extension into antigravity-markdown-viewer-<version>.vsix
 * and remove older .vsix archives in the root directory.
 */
function packageVsix(pkg) {
  const contentTypesXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension=".json" ContentType="application/json"/>',
    '  <Default Extension=".js" ContentType="application/javascript"/>',
    '  <Default Extension=".css" ContentType="text/css"/>',
    '  <Default Extension=".md" ContentType="text/markdown"/>',
    '  <Default Extension=".png" ContentType="image/png"/>',
    '  <Default Extension=".svg" ContentType="image/svg+xml"/>',
    '  <Default Extension=".vsixmanifest" ContentType="text/xml"/>',
    '</Types>'
  ].join('\n');

  const vsixManifest = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">',
    '  <Metadata>',
    `    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}" />`,
    `    <DisplayName>${pkg.displayName}</DisplayName>`,
    `    <Description xml:space="preserve">${pkg.description}</Description>`,
    `    <Tags>${(pkg.keywords || []).join(',')}</Tags>`,
    `    <Categories>${(pkg.categories || []).join(',')}</Categories>`,
    '    <GalleryFlags>Public</GalleryFlags>',
    '    <Properties>',
    `      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}" />`,
    '      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />',
    '      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />',
    '    </Properties>',
    '    <Icon>extension/media/icon.png</Icon>',
    '  </Metadata>',
    '  <Installation>',
    '    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>',
    '  </Installation>',
    '  <Dependencies/>',
    '  <Assets>',
    '    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />',
    '    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />',
    '    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true" />',
    '  </Assets>',
    '</PackageManifest>'
  ].join('\n');

  const filesToInclude = [
    'package.json',
    'README.md',
    'out/extension.js',
    'media/viewer.css',
    'media/viewer.js',
    'media/icon.png',
    'media/icon.svg',
    'examples/django_orm_demo.md'
  ];

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: 'extension.vsixmanifest', data: Buffer.from(vsixManifest, 'utf8') }
  ];

  for (const relPath of filesToInclude) {
    const absPath = path.join(ROOT, relPath);
    assert.ok(fs.existsSync(absPath), `Missing required extension file: ${relPath}`);
    entries.push({
      name: `extension/${relPath}`,
      data: fs.readFileSync(absPath)
    });
  }

  // Clean up stale .vsix files from previous versions
  const existingFiles = fs.readdirSync(ROOT);
  const targetFileName = `${pkg.name}-${pkg.version}.vsix`;
  for (const f of existingFiles) {
    if (f.endsWith('.vsix') && f !== targetFileName) {
      fs.unlinkSync(path.join(ROOT, f));
    }
  }

  const vsixPath = path.join(ROOT, targetFileName);
  const zipBuf = buildZipArchive(entries);
  fs.writeFileSync(vsixPath, zipBuf);
  return vsixPath;
}

function maybeBumpVersion(pkgPath) {
  if (!process.argv.includes('--bump')) {
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const parts = String(pkg.version || '1.1.0').split('.').map((n) => parseInt(n, 10) || 0);
  parts[2] = (parts[2] || 0) + 1;
  pkg.version = `${parts[0]}.${parts[1]}.${parts[2]}`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`✓ Auto-incremented package.json version to ${pkg.version}`);
}

function runVerificationSuite() {
  const pkgPath = path.join(ROOT, 'package.json');
  maybeBumpVersion(pkgPath);

  console.log('=== 1. Generating Extension Icon (media/icon.png) ===');
  const iconPngPath = path.join(ROOT, 'media', 'icon.png');
  generateExtensionIconPng(iconPngPath);
  assert.ok(fs.existsSync(iconPngPath) && fs.statSync(iconPngPath).size > 200);
  console.log('✓ Generated media/icon.png');

  console.log('=== 2. Verifying package.json Manifest ===');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.strictEqual(pkg.name, 'antigravity-markdown-viewer');
  assert.notStrictEqual(pkg.version, '1.0.0', 'Version must not stay at 1.0.0');
  assert.strictEqual(pkg.contributes.customEditors[0].viewType, 'antiMarkdown.artifactEditor');
  const patterns = pkg.contributes.customEditors[0].selector.map((s) => s.filenamePattern);
  assert.ok(patterns.includes('**/*.md'), 'Must match **/*.md across local and WSL Remote');
  console.log(`✓ package.json (v${pkg.version}) customEditors & commands verified`);

  console.log('=== 3. Verifying Security Rules on Source Files ===');
  const extSource = fs.readFileSync(path.join(ROOT, 'out', 'extension.js'), 'utf8');
  const viewerSource = fs.readFileSync(path.join(ROOT, 'media', 'viewer.js'), 'utf8');
  assert.ok(!/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/.test(viewerSource), 'viewer.js must not use innerHTML/outerHTML');
  assert.ok(!/\b(?:localStorage|sessionStorage)\b/.test(viewerSource), 'viewer.js must not use localStorage/sessionStorage');
  assert.ok(extSource.includes("default-src 'none'"), 'extension.js must enforce strict CSP');
  assert.ok(extSource.includes("scheme: 'jetski-artifact'"), 'extension.js must support native jetski-artifact bridge');
  assert.ok(extSource.includes('claude-vscode.insertAtMention'), 'extension.js must support Claude Code @-mention selection');
  assert.ok(extSource.includes('workbench.action.chat.attachSelection'), 'extension.js must support VS Code Copilot Chat selection');
  console.log('✓ Security & AI Chat integration checks passed');

  console.log('=== 4. Testing Markdown AST, Recursive LaTeX Parser & Mermaid ===');
  const viewer = require(path.join(ROOT, 'media', 'viewer.js'));
  const demoMd = fs.readFileSync(path.join(ROOT, 'examples', 'django_orm_demo.md'), 'utf8');
  const demoAst = viewer.parseMarkdownToAst(demoMd);

  assert.strictEqual(demoAst.frontmatter.length, 3, 'Should parse YAML frontmatter');
  assert.ok(demoAst.headings.length >= 6, 'Should extract TOC headings');
  assert.ok(demoAst.blocks.every((b) => typeof b.startLine === 'number' && typeof b.endLine === 'number'), 'Every block must record startLine and endLine');
  assert.ok(demoAst.blocks.some((b) => b.type === 'mermaid'), 'Should parse Mermaid blocks');
  assert.strictEqual(demoAst.blocks.filter((b) => b.type === 'alert').length, 5, 'Should parse all 5 GitHub alerts');
  assert.ok(demoAst.blocks.some((b) => b.type === 'carousel' && b.slides.length === 3), 'Should parse 3-slide carousel');
  assert.ok(demoAst.blocks.some((b) => b.type === 'mathBlock'), 'Should parse $$ mathBlock');

  // Verify nested brace LaTeX argument reader on complex nested fraction
  const nestedFrac = '{T_{\\text{N+1}}}{T_{\\text{Eager}}}';
  const arg1 = viewer.readLatexArgument(nestedFrac, 0);
  const arg2 = viewer.readLatexArgument(nestedFrac, arg1.nextPos);
  assert.strictEqual(arg1.content, 'T_{\\text{N+1}}');
  assert.strictEqual(arg2.content, 'T_{\\text{Eager}}');
  console.log('✓ Verified recursive nested LaTeX parser & block line tracking');

  const brainGuidePath = '/home/mazhao/.gemini/antigravity/brain/64de7d0d-2444-4f96-964a-05b73d2273f5/django_orm_complete_guide.md';
  if (fs.existsSync(brainGuidePath)) {
    const brainMd = fs.readFileSync(brainGuidePath, 'utf8');
    const brainAst = viewer.parseMarkdownToAst(brainMd);
    const mermaidCount = brainAst.blocks.filter((b) => b.type === 'mermaid').length;
    const alertCount = brainAst.blocks.filter((b) => b.type === 'alert').length;
    const tableCount = brainAst.blocks.filter((b) => b.type === 'table').length;
    assert.ok(mermaidCount >= 2, 'Should parse Mermaid diagrams in django_orm_complete_guide.md');
    assert.ok(alertCount >= 2, 'Should parse GitHub alerts in django_orm_complete_guide.md');
    assert.ok(tableCount >= 3, 'Should parse tables in django_orm_complete_guide.md');
    console.log(`✓ Verified compatibility with django_orm_complete_guide.md (${brainAst.headings.length} headings, ${mermaidCount} Mermaid diagrams, ${alertCount} Alerts, ${tableCount} Tables)`);
  }

  console.log('=== 5. Packaging VSIX Archive ===');
  const vsixPath = packageVsix(pkg);
  const vsixSize = fs.statSync(vsixPath).size;
  assert.ok(vsixSize > 5000, 'VSIX package should be non-empty');
  console.log(`✓ Packaged VSIX: ${vsixPath} (${(vsixSize / 1024).toFixed(1)} KB)`);
}

runVerificationSuite();
